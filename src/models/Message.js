import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    instance: { type: mongoose.Schema.Types.ObjectId, ref: 'Instance', required: true, index: true },
    direction: { type: String, enum: ['in', 'out'], default: 'in' },

    number: { type: String, required: true, index: true },
    isLid: { type: Boolean, default: false }, // true if `number` is a WhatsApp LID, not a real phone number
    message: { type: String, default: '' },
    isGroup: { type: Boolean, default: false },
    groupId: { type: String, default: null },
    pushName: { type: String, default: null },
    messageId: { type: String, default: null },

    webhookDelivered: { type: Boolean, default: false },
    webhookAttempts: { type: Number, default: 0 },

    waTimestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model('Message', messageSchema);