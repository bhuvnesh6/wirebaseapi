import { Router } from 'express';
import { requireAuth } from '../middleware/session.js';
import * as ctrl from '../controllers/apiKeyController.js';

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.listApiKeys);
router.post('/', ctrl.createApiKey);
router.post('/:id/revoke', ctrl.revokeApiKey);
router.delete('/:id', ctrl.deleteApiKey);

export default router;
