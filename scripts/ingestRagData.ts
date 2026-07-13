import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
// pdf-parse 沒有官方型別，直接用 require 避免額外裝一包不太維護的 @types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
import OpenAI from 'openai';
import KnowledgeChunk from '../src/models/KnowledgeChunk';

const RAG_DATA_DIR = path.resolve(__dirname, '../../AI_Chat_Optimization/RAG_Data');
const EMBEDDING_MODEL = 'text-embedding-3-small';
const VECTOR_INDEX_NAME = 'knowledge_vector_index';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ARAV 每份是單一物種的照護卡（trifold），檔名不規則，直接列表對應比寫正規表示式可靠
const ARAV_SPECIES_MAP: Record<string, string> = {
  'ARAV_trifold_RedEyedTreeFrog_1-19-18.pdf': 'red_eyed_tree_frog',
  'ARAV_trifold_Sulcata_Tortoise_12-21-17_proof.pdf': 'sulcata_tortoise',
  'ARAV_trifold_Veiled-Chameleon_mt.pdf': 'veiled_chameleon',
  'ARAV_trifold_ball_pythonv2_2.pdf': 'ball_python',
  'ARAV_trifold_bearded_dragon_final31516r2_1.pdf': 'bearded_dragon',
  'ARAV_trifold_boxturtle_12-21-17_proof.pdf': 'box_turtle',
  'ARAV_trifold_cornsnake_4-24.pdf': 'corn_snake',
  'ARAV_trifold_iguana_8.12.15.pdf': 'iguana',
  'ARAV_trifold_leopard_gecko_r2.pdf': 'leopard_gecko',
  'ARAV_trifold_red-eared_sliderv2.pdf': 'red_eared_slider',
};

// AAV 是主題文章而非物種別，盡量標出文章實際針對的鳥種，其餘歸為 general_bird
const AAV_SPECIES_MAP: Record<string, string> = {
  'AAV-Foraging-for-Parrots.pdf': 'parrot',
  'AAV-care-for-senior-parrots.pdf': 'parrot',
  'AAV_Weaning_Baby_Parrots.pdf': 'parrot',
  'AAV_Caring_for_Ducks2022.pdf': 'duck',
  'AAV_Zoonotic_Diseases_Poultr.pdf': 'poultry',
  'Pigeon_Husbandry_Final.pdf': 'pigeon',
};

interface PendingChunk {
  source: string;
  sourceTitle: string;
  species: string;
  chunkIndex: number;
  text: string;
}

function chunkByWords(text: string, chunkWords = 600, overlapWords = 100): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= chunkWords) return [words.join(' ')];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkWords, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}

async function extractPdfText(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const { text } = await pdfParse(buffer);
  return text.replace(/\s+/g, ' ').trim();
}

async function collectChunks(): Promise<PendingChunk[]> {
  const pending: PendingChunk[] = [];
  const folders = fs.readdirSync(RAG_DATA_DIR, { withFileTypes: true }).filter(d => d.isDirectory());

  for (const folder of folders) {
    const isAAV = folder.name.startsWith('AAV');
    const isARAV = folder.name.startsWith('Association of Reptile');
    const source = isAAV ? 'AAV' : isARAV ? 'ARAV' : 'UNKNOWN';
    if (source === 'UNKNOWN') {
      console.warn(`[ingest] 未知來源資料夾，略過: ${folder.name}`);
      continue;
    }

    const folderPath = path.join(RAG_DATA_DIR, folder.name);
    const files = fs.readdirSync(folderPath).filter(f => f.toLowerCase().endsWith('.pdf'));

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const sourceTitle = file.replace(/\.pdf$/i, '');
      const species = source === 'ARAV' ? ARAV_SPECIES_MAP[file] : AAV_SPECIES_MAP[file] ?? 'general_bird';

      if (source === 'ARAV' && !species) {
        console.warn(`[ingest] ARAV 檔案沒有對應的物種設定，略過: ${file}`);
        continue;
      }

      console.log(`[ingest] 解析 ${source}/${file}...`);
      const text = await extractPdfText(filePath);
      if (!text) {
        console.warn(`[ingest] ${file} 抽不出文字，略過`);
        continue;
      }

      // ARAV 照護卡篇幅短，整份當一個 chunk；AAV 文章較長才切塊
      const chunks = source === 'ARAV' ? [text] : chunkByWords(text);
      chunks.forEach((chunkText, chunkIndex) => {
        pending.push({ source, sourceTitle, species, chunkIndex, text: chunkText });
      });
    }
  }

  return pending;
}

async function embedAndUpsert(chunks: PendingChunk[]): Promise<void> {
  const batchSize = 20;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    console.log(`[ingest] 產生 embedding ${i + 1}-${i + batch.length}/${chunks.length}`);

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map(c => c.text),
    });

    await Promise.all(
      batch.map((chunk, idx) =>
        KnowledgeChunk.findOneAndUpdate(
          { sourceTitle: chunk.sourceTitle, chunkIndex: chunk.chunkIndex },
          {
            source: chunk.source,
            sourceTitle: chunk.sourceTitle,
            species: chunk.species,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            embedding: response.data[idx].embedding,
          },
          { upsert: true }
        )
      )
    );
  }
}

async function ensureVectorIndex(): Promise<void> {
  const collection = mongoose.connection.collection('knowledgechunks');
  const existing = await collection.listSearchIndexes().toArray();
  if (existing.some(idx => idx.name === VECTOR_INDEX_NAME)) {
    console.log(`[ingest] 向量索引 ${VECTOR_INDEX_NAME} 已存在，略過建立`);
    return;
  }

  console.log(`[ingest] 建立向量索引 ${VECTOR_INDEX_NAME}...`);
  await collection.createSearchIndex({
    name: VECTOR_INDEX_NAME,
    type: 'vectorSearch',
    definition: {
      fields: [
        { type: 'vector', path: 'embedding', numDimensions: 1536, similarity: 'cosine' },
        { type: 'filter', path: 'species' },
        { type: 'filter', path: 'source' },
      ],
    },
  });
  console.log('[ingest] 索引建立中，Atlas 需要幾分鐘才會顯示 READY，可以先用 Atlas UI 確認狀態。');
}

async function main(): Promise<void> {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('[ingest] MongoDB connected');

  const chunks = await collectChunks();
  console.log(`[ingest] 共 ${chunks.length} 個 chunk 待處理`);

  await embedAndUpsert(chunks);
  await ensureVectorIndex();

  console.log('[ingest] 完成');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[ingest] 執行失敗:', err);
  process.exit(1);
});
