import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/session.js';
import * as ctrl from '../controllers/subadminController.js';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/', ctrl.listSubAdmins);
router.post('/', ctrl.createSubAdmin);
router.patch('/:id/toggle', ctrl.toggleSubAdmin);
router.post('/:id/reset-password', ctrl.resetSubAdminPassword);
router.delete('/:id', ctrl.deleteSubAdmin);

export default router;
