import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import upload from '../middleware/upload';
import { aiLimiter, reportParseLimiter } from '../middleware/rateLimit';
import {
  createPet, getPets, getPet, updatePet, deletePet, updateCareTargets, reorderPets,
  addWeightLog, getWeightLogs,
  addPetLog, getPetLogs, deletePetLog,
  getAiCare,
} from '../controllers/petsController';
import {
  parseVisitReport, getVisitParseJob, createVetVisit, getVetVisits, getVetVisit,
  updateVetVisit, deleteVetVisit,
} from '../controllers/vetVisitsController';

const router = Router();
router.use(requireAuth);

router.post('/', upload.single('photo'), createPet);
router.get('/', getPets);
router.patch('/reorder', reorderPets);
router.get('/:id', getPet);
router.patch('/:id', upload.single('photo'), updatePet);
router.delete('/:id', deletePet);
router.put('/:id/care-targets', updateCareTargets);

router.get('/:id/ai-care', aiLimiter, getAiCare);
router.post('/:id/weight-logs', addWeightLog);
router.get('/:id/weight-logs', getWeightLogs);

router.post('/:id/logs', upload.array('images', 5), addPetLog);
router.get('/:id/logs', getPetLogs);
router.delete('/:id/logs/:logId', deletePetLog);

// 限流一定要放在 upload.single 之後：放前面的話，額度用完時伺服器會在
// 手機還在上傳檔案的當下就回 429 並關閉連線，客戶端收到的是 ERR_NETWORK
// 而不是那個 429，伺服器寫的說明訊息完全送不到使用者眼前。
// 代價是超額時檔案仍會被完整接收一次（記憶體暫存，不會上傳到 Cloudinary），
// 但那只發生在濫用情境，換取正確的錯誤訊息是划算的。
router.post('/:id/vet-visits/parse-report', upload.single('image'), reportParseLimiter, parseVisitReport);
router.get('/:id/vet-visits/parse-jobs/:jobId', getVisitParseJob);
router.post('/:id/vet-visits', createVetVisit);
router.get('/:id/vet-visits', getVetVisits);
router.get('/:id/vet-visits/:visitId', getVetVisit);
router.patch('/:id/vet-visits/:visitId', updateVetVisit);
router.delete('/:id/vet-visits/:visitId', deleteVetVisit);

export default router;
