import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3430;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable CORS
app.use(cors());

// Serve static files from the root directory (e.g., favicon.ico)
app.use(express.static(__dirname));

// Serve media files from the "media" folder
app.use('/media', express.static(path.join(__dirname, 'media')));

// Dynamically serve static files from folders matching "meter??"
const entries = fs.readdirSync(__dirname, { withFileTypes: true });
const meterDirs = entries
  .filter(
    entry => entry.isDirectory() && /^meter.{2}$/.test(entry.name)
  )
  .map(dir => dir.name);

meterDirs.forEach(dir => {
  app.use(`/${dir}`, express.static(path.join(__dirname, dir)));
  // console.log(`Serving static files from /${dir}`);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
