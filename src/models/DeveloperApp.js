import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const developerAppSchema = new mongoose.Schema(
  {
    developer: { type: mongoose.Schema.Types.ObjectId, ref: 'Developer', required: true, index: true },
    name: { type: String, required: true, trim: true },
    clientId: { type: String, required: true, unique: true, trim: true },
    clientSecretHash: { type: String, required: true },
    webhookUrl: { type: String, default: null },
    status: { type: String, enum: ['active', 'revoked'], default: 'active' },
  },
  { timestamps: true }
);

developerAppSchema.methods.compareClientSecret = function (plain) {
  return bcrypt.compare(plain, this.clientSecretHash);
};

developerAppSchema.statics.hashClientSecret = function (plain) {
  return bcrypt.hash(plain, 10);
};

developerAppSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    developer: this.developer,
    name: this.name,
    clientId: this.clientId,
    webhookUrl: this.webhookUrl,
    status: this.status,
    createdAt: this.createdAt,
  };
};

export default mongoose.model('DeveloperApp', developerAppSchema);
