import { Router } from 'express';
import { requireDeveloperApp } from '../middleware/developerAuth.js';
import {
  registerDeveloper,
  loginDeveloper,
  meDeveloper,
  logoutDeveloper,
  requireDeveloperSession,
  createDeveloperApp,
  listDeveloperApps,
  revokeDeveloperApp,
  upsertTenant,
  listTenants,
  createTenantInstance,
  listAppInstances,
  getDeveloperInstanceStatus,
  connectDeveloperInstance,
  getDeveloperQR,
  listDeveloperMessages,
  sendDeveloperMessage,
  updateTenantWebhook,
} from '../controllers/developerController.js';

const router = Router();

router.post('/register', registerDeveloper);
router.post('/login', loginDeveloper);
router.get('/me', requireDeveloperSession, meDeveloper);
router.post('/logout', requireDeveloperSession, logoutDeveloper);

router.post('/apps', requireDeveloperSession, createDeveloperApp);
router.get('/apps', requireDeveloperSession, listDeveloperApps);
router.post('/apps/:id/revoke', requireDeveloperSession, revokeDeveloperApp);

router.post('/tenants', requireDeveloperApp, upsertTenant);
router.get('/tenants', requireDeveloperApp, listTenants);
router.post('/tenants/:externalUserId/instances', requireDeveloperApp, createTenantInstance);
router.post('/tenants/:id/webhook', requireDeveloperApp, updateTenantWebhook);

router.get('/instances', requireDeveloperApp, listAppInstances);
router.get('/instances/:id/status', requireDeveloperApp, getDeveloperInstanceStatus);
router.post('/instances/:id/connect', requireDeveloperApp, connectDeveloperInstance);
router.get('/instances/:id/qr', requireDeveloperApp, getDeveloperQR);
router.get('/instances/:id/messages', requireDeveloperApp, listDeveloperMessages);
router.post('/instances/:id/messages', requireDeveloperApp, sendDeveloperMessage);

export default router;
