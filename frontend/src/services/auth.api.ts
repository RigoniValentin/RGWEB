import api from './api';
import type { LicenseActivationRequestResponse, LicenseActivationResponse, LoginRequest, LoginResponse } from '../types';

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<LoginResponse>('/auth/login', data).then(r => r.data),

  requestLicenseActivationCode: (data: LoginRequest) =>
    api.post<LicenseActivationRequestResponse>('/auth/license/request-code', data).then(r => r.data),

  activateLicense: (data: { activationId: string; code: string }) =>
    api.post<LicenseActivationResponse>('/auth/license/activate', data).then(r => r.data),

  getProfile: () =>
    api.get('/auth/profile').then(r => r.data),
};
