import mongoose, { Document, Schema } from 'mongoose';

export interface IKnowledgeChunk extends Document {
  source: string;       // 'AAV' | 'ARAV'
  sourceTitle: string;  // 檔名（不含副檔名）
  species: string;      // 例如 bearded_dragon、general_bird
  chunkIndex: number;
  text: string;
  embedding: number[];  // text-embedding-3-small，1536 維
  createdAt: Date;
}

const KnowledgeChunkSchema = new Schema<IKnowledgeChunk>(
  {
    source:      { type: String, required: true },
    sourceTitle: { type: String, required: true },
    species:     { type: String, required: true, index: true },
    chunkIndex:  { type: Number, required: true },
    text:        { type: String, required: true },
    embedding:   { type: [Number], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// 每個文件的每個 chunk 只會存在一筆，重複執行 ingestion 腳本時可用 upsert 避免重複
KnowledgeChunkSchema.index({ sourceTitle: 1, chunkIndex: 1 }, { unique: true });

export default mongoose.model<IKnowledgeChunk>('KnowledgeChunk', KnowledgeChunkSchema);
