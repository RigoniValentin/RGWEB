import api from './api';
import type { LoginRequest, LoginResponse } from '../types';

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<LoginResponse>('/auth/login', data).then(r => r.data),

  getProfile: () =>
    api.get('/auth/profile').then(r => r.data),
};
