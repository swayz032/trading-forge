import fs from 'node:fs';

function flatten(report) {
  if (!report || !Array.isArray(report.testResults)) throw new Error('testResults missing');
  const rows=[]; const files=[];
  for(const file of report.testResults){
    if(!Array.isArray(file?.assertionResults)) throw new Error('assertionResults missing');
    const name=String(file.name ?? file.testFilePath ?? '');
    if(!name) throw new Error('file identity missing');
    files.push(name);
    for(const a of file.assertionResults){ rows.push(`${name}\u0000${String(a.fullName ?? a.title ?? '')}\u0000${String(a.status ?? '')}`); }
  }
  files.sort(); rows.sort();
  return {files, rows, success:report.success===true};
}

export function compareVitestEvidence(serial, merged){
  const a=flatten(serial), b=flatten(merged);
  const sameFiles=JSON.stringify(a.files)===JSON.stringify(b.files);
  const sameAssertions=JSON.stringify(a.rows)===JSON.stringify(b.rows);
  const sameSuccess=a.success===b.success;
  return {ok:sameFiles&&sameAssertions&&sameSuccess, same_files:sameFiles, same_assertions:sameAssertions, same_success:sameSuccess, serial_files:a.files.length, merged_files:b.files.length, serial_assertions:a.rows.length, merged_assertions:b.rows.length};
}

if(import.meta.url===`file://${process.argv[1]}`){
  if(process.argv.length<4){console.error('usage: node compare-vitest-evidence.mjs serial.json merged.json');process.exit(2);}
  try{const a=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const b=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));const r=compareVitestEvidence(a,b);console.log(JSON.stringify(r,null,2));if(!r.ok)process.exitCode=1;}catch(err){console.error(err.message);process.exitCode=2;}
}
