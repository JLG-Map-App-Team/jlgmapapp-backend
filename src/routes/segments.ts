import { Router } from 'express';
import { getSegmentsController } from '../controllers/segments.js';

const router = Router();

router.get('/segments', getSegmentsController);

export default router;
