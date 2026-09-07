import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { searchNearby, listPlaces, createPlace, addFavorite, getFavorites, removeFavorite, getPlacePhoto, weatherAt } from '../controllers/mapController';

const router = Router();

// Public — no auth needed to load photos
router.get('/photo', getPlacePhoto as any);

router.use(requireAuth);

router.get('/places', searchNearby);
router.get('/places/list', listPlaces);
router.get('/weather', weatherAt);
router.post('/places', createPlace); // admin only
router.post('/favorites', addFavorite);
router.get('/favorites', getFavorites);
router.delete('/favorites/:placeId', removeFavorite);

export default router;
