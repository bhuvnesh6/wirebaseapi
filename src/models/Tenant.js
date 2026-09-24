import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema(
  {
    app: { type: mongoose.Schema.Types.ObjectId, ref: 'DeveloperApp', required: true, index: true },
    externalUserId: { type: String, required: true, trim: true },
    name: { type: String, default: null },
    webhookUrl: { type: String, default: null },
    webhookSecretHash: { type: String, default: null },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  },
  { timestamps: true }
);

tenantSchema.index({ app: 1, externalUserId: 1 }, { unique: true });

export default mongoose.model('Tenant', tenantSchema);
