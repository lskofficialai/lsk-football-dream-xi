import { copyFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildSquadPools } from './build-squad-pools';
import { checkCareerData } from './check-career';
import { fetchWikidata } from './fetch-wikidata';
import { normalizePlayers } from './normalize-players';

export async function buildAllData() {
  process.env.WRITE_PUBLIC = '0';
  await fetchWikidata();
  await normalizePlayers();
  await buildSquadPools();
  await checkCareerData({ baseDir: 'data/generated' });

  await mkdir('public/data', { recursive: true });
  await copyFile('data/generated/players.json', 'public/data/players.json');
  await copyFile('data/generated/squadPools.json', 'public/data/squadPools.json');
  console.log('Published verified generated data to public/data.');
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  buildAllData().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
