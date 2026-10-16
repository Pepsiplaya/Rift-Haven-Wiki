from pathlib import Path
import hashlib,json,os,subprocess,tempfile
ROOT=Path(__file__).resolve().parents[2]
r=json.loads((ROOT/'Plugin Source/deployment/current-release.json').read_text(encoding='utf-8-sig'));jar=ROOT/r['jar']
assert hashlib.sha256(jar.read_bytes()).hexdigest()==r['jarSha256']
server=ROOT/'.runtime/hytale-server/HytaleServer-23f71f03763422ce7c04df191db49cd0e7d87d43b12baad75c43fdc202410aff.jar'
source="""import java.util.*;import com.google.gson.Gson;import com.mmoserver.riftcore.skills.*;import com.mmoserver.riftcore.professions.ProfessionLevelCurve;import com.mmoserver.riftcore.util.PlayerClassTracker;
class ProgressionExport {public static void main(String[] a){var out=new TreeMap<String,Object>();var skills=new TreeMap<String,Object>();for(var s:Skill.values()){if(s.name().equals("CRAFTING"))continue;var xp=new ArrayList<Long>();for(int l=0;l<=60;l++)xp.add(SkillService.getExpForNextLevel(s,l));skills.put(s.name(),xp);}var classes=new ArrayList<Long>();for(int l=0;l<=60;l++)classes.add(l==0?0:PlayerClassTracker.getExpForNextLevel(l));out.put("professionRevision",ProfessionLevelCurve.REVISION);out.put("professionBySkill",skills);out.put("classes",classes);System.out.println(new Gson().toJson(out));}}
"""
with tempfile.TemporaryDirectory(prefix='rift-progression-') as tmp:
 f=Path(tmp)/'ProgressionExport.java';f.write_text(source,encoding='utf-8')
 run=subprocess.run(['C:/Program Files/Java/jdk-25/bin/java.exe','--class-path',str(jar)+os.pathsep+str(server),str(f)],capture_output=True,text=True,encoding='utf-8',check=True)
 data=json.loads(run.stdout.strip().splitlines()[-1])
p=ROOT/'Website/assets/data/progression.json';old=json.loads(p.read_text(encoding='utf-8'))
# The revision-0/1/2 saved curves remain historical contracts.
old.update(data);p.write_text(json.dumps(old,separators=(',',':'))+'\n',encoding='utf-8')
print('Exported current profession-specific XP curves for '+str(len(data['professionBySkill']))+' professions.')
