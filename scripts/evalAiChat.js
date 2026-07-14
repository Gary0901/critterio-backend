#!/usr/bin/env node
// AI 聊天助理的測試案例自動化執行腳本。
// 不是嚴格的 pass/fail 斷言，是把 AI_Chat_Optimization/optimization_directions.md 裡累積的測試問題
// 自動打一輪、印出完整回答，讓你快速掃一眼有沒有壞掉，取代每次改 prompt 都要在 App 裡一題一題手動重問。
//
// 執行方式（在 backend 目錄下）：
//   EVAL_EMAIL=你的帳號 EVAL_PASSWORD=你的密碼 EVAL_PET_ID=有真實體重/日誌/行事曆紀錄的寵物ID node scripts/evalAiChat.js
//
// EVAL_PET_ID 不給的話，會跳過方向 1（需要綁定寵物）的測試案例，只跑方向 3（RAG + 服務範圍）。

require('dotenv').config();

const BASE_URL = process.env.EVAL_BASE_URL || 'https://critterio-backend.zeabur.app/api/v1';

async function login() {
  const email = process.env.EVAL_EMAIL;
  const password = process.env.EVAL_PASSWORD;
  if (!email || !password) {
    throw new Error('缺少 EVAL_EMAIL / EVAL_PASSWORD，請用環境變數帶入測試帳號密碼');
  }
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`登入失敗: ${json.message}`);
  return json.data.token;
}

async function createConversation(token, petId) {
  const res = await fetch(`${BASE_URL}/ai/conversations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(petId ? { petId } : {}),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`建立對話失敗: ${json.message}`);
  return json.data.id;
}

async function askQuestion(token, convId, content) {
  const res = await fetch(`${BASE_URL}/ai/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) throw new Error(`發送訊息失敗: HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.delta) answer += data.delta;
        else if (data.error) answer += `\n[ERROR] ${data.error}`;
      } catch {
        // ignore malformed line
      }
    }
  }
  return answer;
}

// ─── 測試案例（對應 AI_Chat_Optimization/optimization_directions.md）──────────────

const PET_BOUND_CASES = [
  { title: '體重變化查詢', question: '牠最近體重有變化嗎？', expect: '應提到具體數字/日期，不是空泛建議' },
  { title: '回診/疫苗紀錄查詢', question: '牠上次打疫苗或驅蟲是什麼時候？', expect: '應講出實際日期，不是通用話術' },
  { title: '每日照護狀況查詢', question: '牠最近幾天照護狀況怎樣？', expect: '應引用日誌實際內容，或老實說沒有紀錄' },
  { title: '目前體重 fallback（無歷史紀錄時）', question: '牠現在體重多少？', expect: '若無歷史紀錄，應改答背景資訊裡的目前體重，不能只說沒有紀錄' },
];

const KNOWLEDGE_BASE_CASES = [
  { title: 'RAG - 鬍鬚龍 UVB 燈', question: '鬍鬚龍需要多少瓦數的UVB燈？', expect: '應具體到瓦數範圍，反映 ARAV 文獻內容' },
  { title: 'RAG - 球蟒溫濕度', question: '養球蟒的飼養箱溫度濕度大概怎麼抓？', expect: '應具體到溫濕度數值範圍' },
  { title: 'RAG - 鸚鵡洗澡（general_bird 過濾修正）', question: '鸚鵡可以怎麼幫牠洗澡？', expect: '應對應 AAV-Bathing 的建議方式（噴霧/淋浴等）' },
  { title: '服務範圍 - 資料庫沒有的物種', question: '倉鼠怎麼洗澡？', expect: '應退回模型原本知識正常回答，不可拒答' },
  { title: '服務範圍 - 真正離題問題', question: '今天天氣如何？', expect: '應被服務範圍限制擋掉' },
];

async function runCase(token, convId, { title, question, expect }) {
  console.log(`\n── ${title} ──`);
  console.log(`Q: ${question}`);
  console.log(`預期: ${expect}`);
  try {
    const answer = await askQuestion(token, convId, question);
    console.log(`A: ${answer.trim()}`);
  } catch (err) {
    console.log(`❌ 執行失敗: ${err.message}`);
  }
}

async function main() {
  console.log('登入中...');
  const token = await login();

  const petId = process.env.EVAL_PET_ID;

  console.log('\n========== 方向 1：寵物自家資料查詢 ==========');
  if (!petId) {
    console.log('（未提供 EVAL_PET_ID，略過這組測試。請帶一隻有實際體重/日誌/行事曆紀錄的寵物 ID）');
  } else {
    const convId = await createConversation(token, petId);
    for (const c of PET_BOUND_CASES) {
      await runCase(token, convId, c);
    }
  }

  console.log('\n========== 方向 3：RAG 知識庫 + 服務範圍 ==========');
  for (const c of KNOWLEDGE_BASE_CASES) {
    // 每題開新對話，避免像實機測試那次一樣被上一輪拒答「慣性拒答」干擾判斷
    const convId = await createConversation(token, undefined);
    await runCase(token, convId, c);
  }

  console.log('\n完成，請人工檢查以上回答是否符合每題的「預期」描述。');
}

main().catch((err) => {
  console.error('腳本執行失敗:', err);
  process.exit(1);
});
