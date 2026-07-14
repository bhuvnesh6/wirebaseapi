import { Router } from 'express';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { sendMessage } from '../controllers/publicController.js';

const router = Router();

router.post('/send', requireApiKey, sendMessage);

export default router;
