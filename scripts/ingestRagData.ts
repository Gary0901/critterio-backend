import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
// pdf-parse 沒有官方型別，直接用 require 避免額外裝一包不太維護的 @types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
import OpenAI from 'openai';
import KnowledgeChunk from '../src/models/KnowledgeChunk';

const DAILY_CARE_DIR = path.resolve(__dirname, '../../AI_Chat_Optimization/RAG_Data');
const LAB_DATA_DIR = path.resolve(__dirname, '../../AI_Chat_Optimization/vet_rag_data');
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

// 血檢/生化數值判讀語料，來源與內容見 AI_Chat_Optimization/vet_rag_data/SOURCES.md
// 大多不是針對特定寵物物種撰寫（如鱷魚/眼鏡蛇論文、跨物種判讀指南），歸在 general_bird / general_reptile；
// 陣列代表同一份文件要同時存成多個物種標籤（例如同時涵蓋鳥類與爬蟲類的跨物種指南）
const LAB_SPECIES_MAP: Record<string, string[]> = {
  'PLOS_duck_hematology_biochemistry.pdf': ['duck'],
  'JZAR_eurasian_crane_hematology.pdf': ['general_bird'],
  'Redalyc_vinaceous_amazon_hematology.pdf': ['parrot'],
  'Gribbles_avian_biochemistry_guidelines.html': ['general_bird'],
  'PMC_orinoco_crocodile_hematology.html': ['general_reptile'],
  'PMC_galapagos_tortoise_hematology.html': ['general_reptile'],
  'PMC_indian_cobra_hematology.html': ['general_reptile'],
  'WikiVet_lizard_blood_values.html': ['general_reptile'],
  'WikiVet_lizard_snake_biochemistry.html': ['general_reptile'],
  'Awanui_avian_reptile_hematology_biochemistry.html': ['general_bird', 'general_reptile'],
};

const LAB_SOURCE_MAP: Record<string, string> = {
  'PLOS_duck_hematology_biochemistry.pdf': 'PLOS',
  'JZAR_eurasian_crane_hematology.pdf': 'JZAR',
  'Redalyc_vinaceous_amazon_hematology.pdf': 'Redalyc',
  'Gribbles_avian_biochemistry_guidelines.html': 'Gribbles',
  'PMC_orinoco_crocodile_hematology.html': 'PMC',
  'PMC_galapagos_tortoise_hematology.html': 'PMC',
  'PMC_indian_cobra_hematology.html': 'PMC',
  'WikiVet_lizard_blood_values.html': 'WikiVet',
  'WikiVet_lizard_snake_biochemistry.html': 'WikiVet',
  'Awanui_avian_reptile_hematology_biochemistry.html': 'Awanui',
};

interface PendingChunk {
  source: string;
  sourceTitle: string;
  species: string;
  category: 'daily_care' | 'lab_interpretation';
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

// 網頁類語料沒有 pdf-parse 可用，用簡單的標籤剝除取代——RAG 是拿去產生 embedding 用，
// 不需要完美的排版還原，夠乾淨的純文字即可
function extractHtmlText(filePath: string): string {
  const html = fs.readFileSync(filePath, 'utf-8');
  const withoutNonText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutNonText.replace(/<[^>]+>/g, ' ');
  const decoded = withoutTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
  return decoded.replace(/\s+/g, ' ').trim();
}

async function collectDailyCareChunks(): Promise<PendingChunk[]> {
  const pending: PendingChunk[] = [];
  const folders = fs.readdirSync(DAILY_CARE_DIR, { withFileTypes: true }).filter(d => d.isDirectory());

  for (const folder of folders) {
    const isAAV = folder.name.startsWith('AAV');
    const isARAV = folder.name.startsWith('Association of Reptile');
    const source = isAAV ? 'AAV' : isARAV ? 'ARAV' : 'UNKNOWN';
    if (source === 'UNKNOWN') {
      console.warn(`[ingest] 未知來源資料夾，略過: ${folder.name}`);
      continue;
    }

    const folderPath = path.join(DAILY_CARE_DIR, folder.name);
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
        pending.push({ source, sourceTitle, species, category: 'daily_care', chunkIndex, text: chunkText });
      });
    }
  }

  return pending;
}

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(full));
    else if (/\.(pdf|html)$/i.test(entry.name)) results.push(full);
  }
  return results;
}

async function collectLabInterpretationChunks(): Promise<PendingChunk[]> {
  const pending: PendingChunk[] = [];
  const filePaths = walkFiles(LAB_DATA_DIR);

  for (const filePath of filePaths) {
    const fileName = path.basename(filePath);
    const speciesList = LAB_SPECIES_MAP[fileName];
    const source = LAB_SOURCE_MAP[fileName];
    if (!speciesList || !source) {
      console.warn(`[ingest] 血檢語料沒有對應設定，略過: ${fileName}`);
      continue;
    }

    console.log(`[ingest] 解析 ${source}/${fileName}...`);
    const isPdf = fileName.toLowerCase().endsWith('.pdf');
    const text = isPdf ? await extractPdfText(filePath) : extractHtmlText(filePath);
    if (!text) {
      console.warn(`[ingest] ${fileName} 抽不出文字，略過`);
      continue;
    }

    const chunks = chunkByWords(text);
    // 同一份文件要同時掛在多個物種標籤下時（例如跨物種指南），sourceTitle 加上物種後綴避免撞到唯一索引
    for (const species of speciesList) {
      const sourceTitle = speciesList.length > 1
        ? `${fileName.replace(/\.(pdf|html)$/i, '')}__${species}`
        : fileName.replace(/\.(pdf|html)$/i, '');
      chunks.forEach((chunkText, chunkIndex) => {
        pending.push({ source, sourceTitle, species, category: 'lab_interpretation', chunkIndex, text: chunkText });
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
            category: chunk.category,
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

  const dailyCareChunks = await collectDailyCareChunks();
  const labChunks = await collectLabInterpretationChunks();
  const chunks = [...dailyCareChunks, ...labChunks];
  console.log(`[ingest] 共 ${chunks.length} 個 chunk 待處理（daily_care ${dailyCareChunks.length}、lab_interpretation ${labChunks.length}）`);

  await embedAndUpsert(chunks);
  await ensureVectorIndex();

  console.log('[ingest] 完成');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[ingest] 執行失敗:', err);
  process.exit(1);
});
