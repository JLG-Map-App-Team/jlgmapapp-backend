import express from 'express';
import segmentsRouter from './routes/segments.js';

const app = express();

app.use('/api/v1', segmentsRouter);

export default app;
