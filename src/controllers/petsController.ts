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
    traits: pet.traits,
    careTargets: pet.careTargets,
    createdAt: pet.createdAt,
  };
}

// ─── Pet CRUD ─────────────────────────────────────────────────────────────────

const FREE_PET_LIMIT = 3;

export async function createPet(req: AuthRequest, res: Response): Promise<void> {
  const { name, species, breed, birthday, joinedFamilyAt, gender, weight } = req.body;
  if (!name || !species || !gender || weight == null) {
    res.status(400).json({ success: false, data: null, message: 'name、species、gender、weight 為必填' });
    return;
  }

  const petCount = await Pet.countDocuments({ userId: req.userId });
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
    order: petCount,
  });
  res.status(201).json({ success: true, data: formatPet(pet), message: '建立成功' });
}

export async function getPets(req: AuthRequest, res: Response): Promise<void> {
  const pets = await Pet.find({ userId: req.userId }).sort({ order: 1, createdAt: 1 });
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
    updates.photoUrl = await uploadImage(req.file.buffer, 'critterio/pets');
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
  res.json({ success: true, data: null, message: '日誌已刪除' });
}
