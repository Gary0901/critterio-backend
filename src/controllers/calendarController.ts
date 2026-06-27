import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import CalendarEvent from '../models/CalendarEvent';
import { v4 as uuidv4 } from 'uuid';

// 產生 N 個重複事件的 startTime 陣列
function buildOccurrences(startTime: Date, repeat: string): Date[] {
  const dates: Date[] = [startTime];
  const count = repeat === 'daily' ? 30 : repeat === 'weekly' ? 52 : 12; // daily:30天, weekly:52週, monthly:12個月
  for (let i = 1; i < count; i++) {
    const next = new Date(startTime);
    if (repeat === 'daily')   next.setDate(next.getDate() + i);
    if (repeat === 'weekly')  next.setDate(next.getDate() + i * 7);
    if (repeat === 'monthly') next.setMonth(next.getMonth() + i);
    dates.push(next);
  }
  return dates;
}

export async function createEvent(req: AuthRequest, res: Response): Promise<void> {
  const { petId, title, type, startTime, endTime, note, repeat = 'none', recurringId } = req.body;
  if (!title || !type || !startTime) {
    res.status(400).json({ success: false, data: null, message: 'title、type、startTime 為必填' });
    return;
  }

  const base = {
    userId: req.userId,
    petId: petId ?? undefined,
    title, type,
    startTime: new Date(startTime),
    endTime: endTime ? new Date(endTime) : undefined,
    note: note ?? undefined,
    done: false,
    repeat,
  };

  if (repeat === 'none') {
    const event = await CalendarEvent.create(base);
    res.status(201).json({ success: true, data: event, message: '成功加入行事曆' });
    return;
  }

  // 重複事件：批次建立，共用 recurringId
  const sharedId = recurringId ?? uuidv4();
  const occurrences = buildOccurrences(new Date(startTime), repeat);
  const endMs = endTime ? new Date(endTime).getTime() - new Date(startTime).getTime() : 0;

  const docs = occurrences.map((date) => ({
    ...base,
    startTime: date,
    endTime: endMs > 0 ? new Date(date.getTime() + endMs) : undefined,
    recurringId: sharedId,
  }));
  const events = await CalendarEvent.insertMany(docs);
  res.status(201).json({ success: true, data: events[0], message: '成功加入行事曆' });
}

export async function getEvents(req: AuthRequest, res: Response): Promise<void> {
  const { petId, year, month } = req.query as Record<string, string>;
  if (!year || !month) {
    res.status(400).json({ success: false, data: null, message: 'year 與 month 為必填' });
    return;
  }
  const start = new Date(parseInt(year), parseInt(month) - 1, 1);
  const end   = new Date(parseInt(year), parseInt(month), 1);

  const filter: Record<string, any> = {
    userId: req.userId,
    startTime: { $gte: start, $lt: end },
  };
  if (petId) filter.petId = petId;

  const events = await CalendarEvent.find(filter).sort({ startTime: 1 });
  res.json({ success: true, data: events, message: '' });
}

export async function getEvent(req: AuthRequest, res: Response): Promise<void> {
  const event = await CalendarEvent.findOne({ _id: req.params.eventId, userId: req.userId });
  if (!event) {
    res.status(404).json({ success: false, data: null, message: '找不到事件' });
    return;
  }
  res.json({ success: true, data: event, message: '' });
}

export async function updateEvent(req: AuthRequest, res: Response): Promise<void> {
  const allowed = ['title', 'type', 'startTime', 'endTime', 'note'];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.startTime) updates.startTime = new Date(updates.startTime);
  if (updates.endTime)   updates.endTime   = new Date(updates.endTime);

  const event = await CalendarEvent.findOneAndUpdate(
    { _id: req.params.eventId, userId: req.userId },
    { $set: updates },
    { new: true }
  );
  if (!event) {
    res.status(404).json({ success: false, data: null, message: '找不到事件' });
    return;
  }
  res.json({ success: true, data: event, message: '事件更新成功' });
}

export async function toggleDone(req: AuthRequest, res: Response): Promise<void> {
  const { done } = req.body;
  if (done === undefined) {
    res.status(400).json({ success: false, data: null, message: 'done 為必填' });
    return;
  }
  const event = await CalendarEvent.findOneAndUpdate(
    { _id: req.params.eventId, userId: req.userId },
    { $set: { done } },
    { new: true }
  );
  if (!event) {
    res.status(404).json({ success: false, data: null, message: '找不到事件' });
    return;
  }
  res.json({ success: true, data: { id: event._id, done: event.done }, message: '' });
}

export async function deleteEvent(req: AuthRequest, res: Response): Promise<void> {
  const type = (req.query.type as string) ?? 'this';
  const event = await CalendarEvent.findOne({ _id: req.params.eventId, userId: req.userId });
  if (!event) {
    res.status(404).json({ success: false, data: null, message: '找不到事件' });
    return;
  }

  if (type === 'all' && event.recurringId) {
    await CalendarEvent.deleteMany({ recurringId: event.recurringId, userId: req.userId });
  } else {
    await CalendarEvent.findByIdAndDelete(event._id);
  }
  res.json({ success: true, data: null, message: '事件已刪除' });
}
