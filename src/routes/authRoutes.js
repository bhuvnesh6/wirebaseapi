import { Router } from 'express';
import { adminLogin, subadminLogin, me, logout } from '../controllers/authController.js';
import { requireAuth } from '../middleware/session.js';

const router = Router();

router.post('/admin-login', adminLogin);
router.post('/login', subadminLogin);
router.get('/me', me);
router.post('/logout', requireAuth, logout);

export default router;
