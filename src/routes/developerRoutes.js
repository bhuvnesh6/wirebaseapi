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
  rotateDeveloperAppSecret,
  upsertTenant,
  listTenants,
  getTenant,
  deleteTenant,
  updateTenantWebhook,
  createTenantInstance,
  listTenantInstances,
  listAppInstances,
  getDeveloperInstance,
  updateInstanceWebhook,
  getDeveloperInstanceStatus,
  connectDeveloperInstance,
  logoutDeveloperInstance,
  deleteDeveloperInstance,
  getDeveloperQR,
  listDeveloperMessages,
  sendDeveloperMessage,
} from '../controllers/developerController.js';

const router = Router();

// Express 4 does not catch rejected promises from async handlers - forward them to the error handler.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- developer account (session cookie) ---
router.post('/register', h(registerDeveloper));
router.post('/login', h(loginDeveloper));
router.get('/me', h(requireDeveloperSession), meDeveloper);
router.post('/logout', h(requireDeveloperSession), logoutDeveloper);

// --- apps (session cookie) ---
router.post('/apps', h(requireDeveloperSession), h(createDeveloperApp));
router.get('/apps', h(requireDeveloperSession), h(listDeveloperApps));
router.post('/apps/:id/revoke', h(requireDeveloperSession), h(revokeDeveloperApp));
router.post('/apps/:id/rotate-secret', h(requireDeveloperSession), h(rotateDeveloperAppSecret));

// --- everything below is authenticated with the app secret ---
router.post('/tenants', h(requireDeveloperApp), h(upsertTenant));
router.get('/tenants', h(requireDeveloperApp), h(listTenants));
router.get('/tenants/:externalUserId', h(requireDeveloperApp), h(getTenant));
router.delete('/tenants/:externalUserId', h(requireDeveloperApp), h(deleteTenant));
router.post('/tenants/:id/webhook', h(requireDeveloperApp), h(updateTenantWebhook));
router.post('/tenants/:externalUserId/instances', h(requireDeveloperApp), h(createTenantInstance));
router.get('/tenants/:externalUserId/instances', h(requireDeveloperApp), h(listTenantInstances));

router.get('/instances', h(requireDeveloperApp), h(listAppInstances));
router.get('/instances/:id', h(requireDeveloperApp), h(getDeveloperInstance));
router.delete('/instances/:id', h(requireDeveloperApp), h(deleteDeveloperInstance));
router.patch('/instances/:id/webhook', h(requireDeveloperApp), h(updateInstanceWebhook));
router.get('/instances/:id/status', h(requireDeveloperApp), h(getDeveloperInstanceStatus));
router.post('/instances/:id/connect', h(requireDeveloperApp), h(connectDeveloperInstance));
router.post('/instances/:id/logout', h(requireDeveloperApp), h(logoutDeveloperInstance));
router.get('/instances/:id/qr', h(requireDeveloperApp), h(getDeveloperQR));
router.get('/instances/:id/messages', h(requireDeveloperApp), h(listDeveloperMessages));
router.post('/instances/:id/messages', h(requireDeveloperApp), h(sendDeveloperMessage));

export default router;