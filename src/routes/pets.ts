import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import upload from '../middleware/upload';
import {
  createPet, getPets, getPet, updatePet, deletePet, updateCareTargets, reorderPets,
  addWeightLog, getWeightLogs,
  addPetLog, getPetLogs, deletePetLog,
  getAiCare,
} from '../controllers/petsController';

const router = Router();
router.use(requireAuth);

router.post('/', upload.single('photo'), createPet);
router.get('/', getPets);
router.patch('/reorder', reorderPets);
router.get('/:id', getPet);
router.patch('/:id', upload.single('photo'), updatePet);
router.delete('/:id', deletePet);
router.put('/:id/care-targets', updateCareTargets);

router.get('/:id/ai-care', getAiCare);
router.post('/:id/weight-logs', addWeightLog);
router.get('/:id/weight-logs', getWeightLogs);

router.post('/:id/logs', upload.array('images', 5), addPetLog);
router.get('/:id/logs', getPetLogs);
router.delete('/:id/logs/:logId', deletePetLog);

export default router;
