import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const developerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  },
  { timestamps: true }
);

developerSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

developerSchema.statics.hashPassword = function (plain) {
  return bcrypt.hash(plain, 10);
};

developerSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    status: this.status,
    createdAt: this.createdAt,
  };
};

export default mongoose.model('Developer', developerSchema);
