import { config } from './src/config/index.js';
import jwt from 'jsonwebtoken';
const t = jwt.sign({id:1,nombre:'test'}, config.jwt.secret, {expiresIn:'5m'});
console.log(t);
