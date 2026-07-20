import OpenAI from 'openai';
import KnowledgeChunk from '../models/KnowledgeChunk';

const KNOWLEDGE_VECTOR_INDEX = 'knowledge_vector_index';
const EMBEDDING_MODEL = 'text-embedding-3-small';
// AAV 文章多半是主題文（洗澡/換羽/斷奶等），不特定物種的歸在 general_bird；
// 查詢鳥類物種時要一併納入 general_bird，不然會漏掉這些其實相關的文章
export const BIRD_SPECIES = new Set(['parrot', 'duck', 'poultry', 'pigeon', 'general_bird']);
// 爬蟲類血檢判讀文獻多半不是針對特定寵物物種（如鱷魚、眼鏡蛇論文），歸在 general_reptile
export const REPTILE_SPECIES = new Set([
  'ball_python', 'bearded_dragon', 'box_turtle', 'corn_snake', 'iguana',
  'leopard_gecko', 'red_eared_slider', 'red_eyed_tree_frog', 'sulcata_tortoise', 'veiled_chameleon',
]);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Pet model 的 species 欄位只有粗略分類（'bird'/'reptile'），KnowledgeChunk 的 species 卻是精細物種代碼
// （bearded_dragon、parrot...），兩者不能直接拿來當 filter 用，這裡負責把粗分類展開成完整物種代碼集合，
// 精細物種代碼查詢時也一併帶入該類別的 general_* fallback，避免漏掉不特定物種的文獻
function resolveSpeciesFilter(species: string): string | { $in: string[] } {
  if (species === 'bird') return { $in: [...BIRD_SPECIES] };
  if (species === 'reptile') return { $in: [...REPTILE_SPECIES, 'general_reptile'] };
  if (BIRD_SPECIES.has(species)) return { $in: [species, 'general_bird'] };
  if (REPTILE_SPECIES.has(species)) return { $in: [species, 'general_reptile'] };
  return species;
}

export async function searchKnowledgeBase(
  query: string,
  species?: string,
  category?: 'daily_care' | 'lab_interpretation'
): Promise<unknown> {
  const embeddingRes = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: query });
  const queryVector = embeddingRes.data[0].embedding;

  // Atlas Search 索引目前只對 species/source 建了 filter 欄位，category 用後製過濾即可，
  // 不需要改動正式環境的向量索引設定；有指定 category 時多拿一些候選，確保過濾後還有結果
  const results = await KnowledgeChunk.aggregate([
    {
      $vectorSearch: {
        index: KNOWLEDGE_VECTOR_INDEX,
        path: 'embedding',
        queryVector,
        numCandidates: 100,
        limit: category ? 15 : 5,
        ...(species ? { filter: { species: resolveSpeciesFilter(species) } } : {}),
      },
    },
    { $project: { _id: 0, source: 1, sourceTitle: 1, species: 1, category: 1, text: 1 } },
  ]);

  const filtered = category ? results.filter((r: any) => r.category === category) : results;
  return filtered.slice(0, 5);
}
