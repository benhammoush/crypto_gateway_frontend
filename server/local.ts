/**
 * Local HTTP adapter for server-only merchant operations.
 * @packageDocumentation
 */

import { createServer } from 'node:http';
import { merchantHandler } from './merchant';

createServer((req, res) => {
  void merchantHandler(req, res);
}).listen(3001, '127.0.0.1');
