import mongoose from 'mongoose';

const apiKeySchema = new mongoose.Schema(
  {
    ownerRole: { type: String, enum: ['admin', 'subadmin'], required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    label: { type: String, required: true, trim: true },
    prefix: { type: String, required: true },
    keyHash: { type: String, required: true }, // sha256 of the full key - the full key is never stored
    revoked: { type: Boolean, default: false },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('ApiKey', apiKeySchema);
