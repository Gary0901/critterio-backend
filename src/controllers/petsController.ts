import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Pet from '../models/Pet';
import WeightLog from '../models/WeightLog';
import PetLog from '../models/PetLog';
import CalendarEvent from '../models/CalendarEvent';
import VetVisit from '../models/VetVisit';
import mongoose from 'mongoose';
import { uploadImage, deleteImageByUrl } from '../utils/cloudinary';
import { generatePetCare } from '../utils/groq';

function calcAge(birthday?: Date): number {
  if (!birthday) return 0;
  const months =
    (new Date().getFullYear() - birthday.getFullYear()) * 12 +
    (new Date().getMonth() - birthday.getMonth());
  return Math.max(0, Math.floor(months / 12));
}

function formatPet(pet: any) {
  return {
    id: pet._id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed,
    birthday:       pet.birthday ?? null,
    joinedFamilyAt: pet.joinedFamilyAt ?? null,
    age: calcAge(pet.birthday),
    weightKg: pet.weight,
    heightCm: pet.heightCm ?? 0,
    gender: pet.gender,
    photoUrl: pet.photoUrl ?? null,
    color: pet.color ?? null,
    traits: pet.traits,
    careTargets: pet.careTargets,
    createdAt: pet.createdAt,
  };
}

/**
 * 寵物識別色調色盤長度。跟 frontend/src/constants/petColors.ts 綁在一起 ——
 * 那邊加色的話這裡要一起改。
 */
const PET_COLOR_COUNT = 8;

/** 挑一個這位使用者還沒用過的顏色。全滿了（理論上不會，寵物有上限）就從頭循環 */
function pickFreeColor(used: (number | undefined | null)[]): number {
  const taken = new Set(used.filter((c): c is number => typeof c === 'number'));
  for (let i = 0; i < PET_COLOR_COUNT; i++) {
    if (!taken.has(i)) return i;
  }
  return used.length % PET_COLOR_COUNT;
}

/** 生日／加入家庭的週年要建幾年份。repeat 沒有 'yearly'，只能逐年建立 */
const ANNIVERSARY_YEARS = 5;
/**
 * 里程碑天數。兩組相同 —— 出生和加入家庭都用同一套節奏，
 * 使用者比較好預期，也省得記兩種規則。
 * 2000 天約 5.5 年，跟 ANNIVERSARY_YEARS 的涵蓋範圍差不多。
 */
const MILESTONE_DAYS = [100, 300, 500, 1000, 1500, 2000];
const BIRTH_MILESTONE_DAYS = MILESTONE_DAYS;
const FAMILY_MILESTONE_DAYS = MILESTONE_DAYS;

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/**
 * App 所在時區。跟 aiController 的 APP_TIME_ZONE 是同一件事 ——
 * 伺服器跑在 UTC，直接 setHours(0) 存進去，使用者在台北看到的會是早上 8 點。
 */
const APP_UTC_OFFSET_HOURS = 8; // Asia/Taipei

/**
 * 轉成「使用者本機午夜」對應的 UTC 時間。
 *
 * 前端是用「本機時間的時分是不是 00:00」來判斷全天事件的（見 api/index.ts），
 * 所以紀念日必須存成台北午夜，否則會顯示成有時間的一般事件。
 */
function localMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      APP_UTC_OFFSET_HOURS * 3600 * 1000,
  );
}

/**
 * 依寵物的 birthday / joinedFamilyAt 重建所有自動紀念事件。
 *
 * 先刪後建（用 autoKind 篩選），所以使用者改了生日就會自動同步，
 * 而且不會動到他自己建立的事件。
 * 已經過去的里程碑不建 —— 那對使用者沒有意義，只會塞滿歷史月份。
 */
async function syncPetAnniversaries(pet: any): Promise<void> {
  await CalendarEvent.deleteMany({ petId: pet._id, autoKind: { $exists: true } });

  const now = Date.now();
  const docs: any[] = [];
  const push = (title: string, when: Date, autoKind: string) => {
    if (when.getTime() < now) return; // 過去的不建
    docs.push({
      userId: pet.userId,
      petId: pet._id,
      title,
      type: 'anniversary',
      startTime: localMidnight(when),
      done: false,
      repeat: 'none',
      autoKind,
    });
  };

  if (pet.birthday) {
    const b = new Date(pet.birthday);
    const thisYear = new Date().getFullYear();
    for (let i = 0; i <= ANNIVERSARY_YEARS; i++) {
      const d = new Date(b);
      d.setFullYear(thisYear + i);
      const age = thisYear + i - b.getFullYear();
      push(`${pet.name} ${age} 歲生日 🎂`, d, 'birthday');
    }
    for (const n of BIRTH_MILESTONE_DAYS) {
      push(`${pet.name} 出生第 ${n} 天`, addDays(b, n), 'birthMilestone');
    }
  }

  if (pet.joinedFamilyAt) {
    const j = new Date(pet.joinedFamilyAt);
    const thisYear = new Date().getFullYear();
    for (let i = 0; i <= ANNIVERSARY_YEARS; i++) {
      const d = new Date(j);
      d.setFullYear(thisYear + i);
      const years = thisYear + i - j.getFullYear();
      if (years <= 0) continue;
      push(`${pet.name} 加入家庭 ${years} 週年 🏠`, d, 'family');
    }
    for (const n of FAMILY_MILESTONE_DAYS) {
      push(`${pet.name} 加入家庭第 ${n} 天`, addDays(j, n), 'familyMilestone');
    }
  }

  if (docs.length > 0) await CalendarEvent.insertMany(docs);
}

// ─── Pet CRUD ─────────────────────────────────────────────────────────────────

const FREE_PET_LIMIT = 3;

export async function createPet(req: AuthRequest, res: Response): Promise<void> {
  const { name, species, breed, birthday, joinedFamilyAt, gender, weight } = req.body;
  if (!name || !species || !gender || weight == null) {
    res.status(400).json({ success: false, data: null, message: 'name、species、gender、weight 為必填' });
    return;
  }

  // 需要既有寵物的顏色來避開重複，順便取代原本的 countDocuments
  const existing = await Pet.find({ userId: req.userId }).select('color').lean();
  const petCount = existing.length;
  if (petCount >= FREE_PET_LIMIT) {
    res.status(403).json({ success: false, data: null, message: `免費方案最多新增 ${FREE_PET_LIMIT} 隻寵物` });
    return;
  }

  let photoUrl: string | undefined;
  if (req.file) {
    photoUrl = await uploadImage(req.file.buffer, 'critterio/pets');
  }

  const pet = await Pet.create({
    userId: req.userId,
    name, species,
    breed: breed ?? '',
    birthday:       birthday       ? new Date(birthday)       : undefined,
    joinedFamilyAt: joinedFamilyAt ? new Date(joinedFamilyAt) : undefined,
    gender, weight,
    photoUrl,
    traits: [],
    careTargets: [],
    color: pickFreeColor(existing.map((p: any) => p.color)),
    order: petCount,
  });
  // 紀念事件失敗不該讓建立寵物整個失敗
  await syncPetAnniversaries(pet).catch(() => {});
  res.status(201).json({ success: true, data: formatPet(pet), message: '建立成功' });
}

export async function getPets(req: AuthRequest, res: Response): Promise<void> {
  const pets = await Pet.find({ userId: req.userId }).sort({ order: 1, createdAt: 1 });

  // color 是後來才加的欄位，舊寵物沒有值。在這裡補齊並存回去，
  // 就不需要另外跑一支 migration，而且只會發生一次。
  const missing = pets.filter((p) => typeof p.color !== 'number');
  if (missing.length > 0) {
    const used = pets.map((p) => p.color);
    for (const pet of missing) {
      pet.color = pickFreeColor(used);
      used.push(pet.color);
    }
    await Promise.all(missing.map((p) => p.save()));
  }

  res.json({ success: true, data: pets.map(formatPet), message: '' });
}

export async function reorderPets(req: AuthRequest, res: Response): Promise<void> {
  const { petIds } = req.body;
  if (!Array.isArray(petIds) || petIds.some((id) => typeof id !== 'string')) {
    res.status(400).json({ success: false, data: null, message: 'petIds 必須為字串陣列' });
    return;
  }
  await Pet.bulkWrite(
    petIds.map((id, index) => ({
      updateOne: {
        filter: { _id: id, userId: req.userId },
        update: { $set: { order: index } },
      },
    }))
  );
  res.json({ success: true, data: null, message: '排序已更新' });
}

export async function getPet(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  res.json({ success: true, data: formatPet(pet), message: '' });
}

export async function updatePet(req: AuthRequest, res: Response): Promise<void> {
  const allowed = ['name', 'species', 'breed', 'birthday', 'joinedFamilyAt', 'gender', 'weight', 'heightCm', 'traits'];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (req.body.birthday)       updates.birthday       = new Date(req.body.birthday);
  if (req.body.joinedFamilyAt) updates.joinedFamilyAt = new Date(req.body.joinedFamilyAt);
  if (req.file) {
    // 換照片時要把舊的刪掉，否則 Cloudinary 會累積沒人引用的圖。
    // 先查舊值再上傳，刪除失敗不擋流程。
    const prev = await Pet.findOne({ _id: req.params.id, userId: req.userId }).select('photoUrl').lean();
    updates.photoUrl = await uploadImage(req.file.buffer, 'critterio/pets');
    const oldUrl = (prev as any)?.photoUrl;
    if (oldUrl) await deleteImageByUrl(oldUrl).catch(() => {});
  }

  // multipart 的欄位一律是字串，不能直接用 typeof 判斷
  if (req.body.color !== undefined && req.body.color !== null && req.body.color !== '') {
    const idx = Number(req.body.color);
    if (!Number.isInteger(idx) || idx < 0 || idx >= PET_COLOR_COUNT) {
      res.status(400).json({ success: false, data: null, message: '顏色索引不正確' });
      return;
    }
    const clash = await Pet.findOne({
      userId: req.userId,
      _id: { $ne: req.params.id },
      color: idx,
    }).select('name').lean();
    if (clash) {
      res.status(409).json({
        success: false, data: null,
        message: `這個顏色已經是「${(clash as any).name}」的了，請換一個`,
      });
      return;
    }
    updates.color = idx;
  }

  const pet = await Pet.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: updates },
    { new: true }
  );
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  // 只有日期或名字變了才重建 —— 名字也要，因為事件標題帶了寵物名
  if (updates.birthday || updates.joinedFamilyAt || updates.name) {
    await syncPetAnniversaries(pet).catch(() => {});
  }
  res.json({ success: true, data: formatPet(pet), message: '更新成功' });
}

export async function deletePet(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }

  const logs = await PetLog.find({ petId: pet._id }).select('images').lean();
  const logImageUrls = logs.flatMap((l) => (l.images ?? []).map((img: any) => img.url));

  const vetVisits = await VetVisit.find({ petId: pet._id }).select('imageUrl').lean();
  const vetVisitImageUrls = vetVisits.map((r) => r.imageUrl).filter((url): url is string => !!url);

  await Promise.all([
    WeightLog.deleteMany({ petId: pet._id }),
    PetLog.deleteMany({ petId: pet._id }),
    CalendarEvent.deleteMany({ petId: pet._id }),
    VetVisit.deleteMany({ petId: pet._id }),
    ...logImageUrls.map((url) => deleteImageByUrl(url).catch((e) =>
      console.error(`[deletePet] 日誌圖片刪除失敗，petId=${pet._id}`, e)
    )),
    ...vetVisitImageUrls.map((url) => deleteImageByUrl(url).catch((e) =>
      console.error(`[deletePet] 就醫紀錄圖片刪除失敗，petId=${pet._id}`, e)
    )),
    ...(pet.photoUrl ? [deleteImageByUrl(pet.photoUrl).catch((e) =>
      console.error(`[deletePet] 頭像刪除失敗，petId=${pet._id}`, e)
    )] : []),
  ]);

  res.json({ success: true, data: null, message: '寵物檔案已刪除' });
}

export async function updateCareTargets(req: AuthRequest, res: Response): Promise<void> {
  const { careTargets } = req.body;
  if (!Array.isArray(careTargets)) {
    res.status(400).json({ success: false, data: null, message: 'careTargets 必須為陣列' });
    return;
  }
  const pet = await Pet.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: { careTargets } },
    { new: true }
  );
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  res.json({ success: true, data: null, message: '照護設定更新成功' });
}

// ─── Weight Logs ──────────────────────────────────────────────────────────────

export async function addWeightLog(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const { weightKg, recordedAt } = req.body;
  if (weightKg == null) {
    res.status(400).json({ success: false, data: null, message: 'weightKg 為必填' });
    return;
  }
  const log = await WeightLog.create({
    petId: pet._id,
    weightKg,
    recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
  });
  // 同步更新 Pet 的當前體重
  await Pet.findByIdAndUpdate(pet._id, { weight: weightKg });

  res.status(201).json({ success: true, data: { id: log._id, petId: log.petId, weightKg: log.weightKg, recordedAt: log.recordedAt }, message: '體重紀錄已儲存' });
}

export async function getWeightLogs(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const limit = parseInt(String(req.query.limit ?? '12'));
  const logs = await WeightLog.find({ petId: pet._id })
    .sort({ recordedAt: -1 })
    .limit(limit);
  res.json({ success: true, data: logs.map(l => ({ id: l._id, weightKg: l.weightKg, recordedAt: l.recordedAt })), message: '' });
}

// ─── Pet Logs ─────────────────────────────────────────────────────────────────

export async function addPetLog(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const { title, content, date, mood, hashtags } = req.body;
  if (!content || !date) {
    res.status(400).json({ success: false, data: null, message: 'content 與 date 為必填' });
    return;
  }
  const files = req.files as Express.Multer.File[] | undefined;
  const images: { url: string; takenAt?: string }[] = [];
  if (files && files.length > 0) {
    for (const file of files) {
      const url = await uploadImage(file.buffer, 'critterio/logs');
      images.push({ url });
    }
  }
  const log = await PetLog.create({
    petId: pet._id,
    date: new Date(date),
    title: title ?? undefined,
    content,
    images,
    mood: Array.isArray(mood) ? mood : (mood ? [mood] : []),
    hashtags: Array.isArray(hashtags) ? hashtags : (hashtags ? [hashtags] : []),
  });
  res.status(201).json({ success: true, data: log, message: '日誌儲存成功' });
}

export async function getPetLogs(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const { startDate, endDate, page = '1', limit = '20' } = req.query as Record<string, string>;
  const filter: Record<string, any> = { petId: pet._id };
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) filter.date.$lte = new Date(endDate);
  }
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const logs = await PetLog.find(filter).sort({ date: -1 }).skip(skip).limit(parseInt(limit));
  res.json({ success: true, data: logs, message: '' });
}

export async function getAiCare(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const birthday = pet.birthday ?? new Date();
  const months = (new Date().getFullYear() - birthday.getFullYear()) * 12
    + (new Date().getMonth() - birthday.getMonth());
  const age = Math.max(0, Math.floor(months / 12));

  try {
    const result = await generatePetCare({
      name: pet.name,
      species: pet.species,
      breed: pet.breed,
      age,
      gender: pet.gender,
      weightKg: pet.weight,
      heightCm: pet.heightCm ?? 0,
    });
    res.json({ success: true, data: result, message: '' });
  } catch (err) {
    console.error('[Groq] 生成照護建議失敗:', err);
    res.status(500).json({ success: false, data: null, message: 'AI 建議生成失敗，請稍後再試' });
  }
}

export async function deletePetLog(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const log = await PetLog.findOneAndDelete({ _id: req.params.logId, petId: pet._id });
  if (!log) {
    res.status(404).json({ success: false, data: null, message: '找不到日誌' });
    return;
  }

  // 刪掉這篇日誌的圖片。刪除寵物那條路徑本來就有清，單篇刪除漏了。
  const urls = (log.images ?? []).map((img: any) => img.url).filter(Boolean);
  await Promise.all(urls.map((url: string) => deleteImageByUrl(url).catch(() => {})));

  res.json({ success: true, data: null, message: '日誌已刪除' });
}
