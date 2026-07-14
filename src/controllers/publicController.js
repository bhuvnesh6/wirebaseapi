import Instance from '../models/Instance.js';
import Message from '../models/Message.js';
import * as baileysManager from '../services/baileysManager.js';

const MEDIA_TYPES = ['image', 'video', 'audio', 'document'];

function buildContent(body) {
  const { type = 'text', message, url, caption, filename, mimetype } = body;

  if (type === 'text') {
    if (!message) throw new Error('message is required for type "text"');
    return { text: message };
  }

  if (MEDIA_TYPES.includes(type)) {
    if (!url) throw new Error(`url is required for type "${type}"`);
    const content = { [type]: { url } };
    if (caption) content.caption = caption;
    if (type === 'document') {
      content.fileName = filename || 'file';
      content.mimetype = mimetype || 'application/octet-stream';
    }
    if (type === 'audio' && mimetype) content.mimetype = mimetype;
    return content;
  }

  throw new Error(`Unsupported type "${type}". Use one of: text, image, video, audio, document`);
}

export async function sendMessage(req, res) {
  try {
    const { instanceId, instanceName, to } = req.body;
    if ((!instanceId && !instanceName) || !to) {
      return res.status(400).json({ error: 'to and either instanceId or instanceName are required' });
    }

    const ownerScope = {
      ownerRole: req.apiKeyOwnerRole,
      ownerId: req.apiKeyOwnerRole === 'admin' ? null : req.apiKeyOwnerId,
    };

    // Looking up by name (not just id) is what guarantees the message goes out from the
    // exact number the caller intended, even if they only know the instance's label.
    const instance = instanceName
      ? await Instance.findOne({ ...ownerScope, name: instanceName })
      : await Instance.findOne({ _id: instanceId, ...ownerScope });

    if (!instance) {
      return res.status(404).json({ error: 'No instance found with that name/id for this API key' });
    }
    if (instance.status !== 'connected') {
      return res.status(409).json({ error: `Instance "${instance.name}" is not connected (status: ${instance.status})` });
    }

    let content;
    try {
      content = buildContent(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const result = await baileysManager.sendContent(instance._id.toString(), to, content);

    await Message.create({
      instance: instance._id,
      direction: 'out',
      number: to.replace('@s.whatsapp.net', ''),
      message: req.body.message || req.body.caption || `[${req.body.type || 'text'}]`,
      messageId: result?.key?.id || null,
      waTimestamp: new Date(),
    });

    res.json({ success: true, instanceId: instance._id, instanceName: instance.name, messageId: result?.key?.id || null });
  } catch (err) {
    console.error('public sendMessage error:', err);
    res.status(500).json({ error: err.message || 'Failed to send message' });
  }
}
