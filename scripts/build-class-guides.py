from pathlib import Path
import hashlib,json,os,subprocess,tempfile
ROOT=Path(__file__).resolve().parents[2];SITE=ROOT/'Website'
r=json.loads((ROOT/'Plugin Source/deployment/current-release.json').read_text(encoding='utf-8-sig'));jar=ROOT/r['jar']
assert hashlib.sha256(jar.read_bytes()).hexdigest()==r['jarSha256']
server=ROOT/'.runtime/hytale-server/HytaleServer-23f71f03763422ce7c04df191db49cd0e7d87d43b12baad75c43fdc202410aff.jar'
source='''import java.util.*;import com.google.gson.*;import com.hypixel.hytale.server.core.ui.builder.*;import com.mmoserver.riftcore.character.*;import com.mmoserver.riftcore.gui.CharacterCreationScreen;import com.mmoserver.riftcore.data.ReleaseClassRoster;
class ClassGuideExport {public static void main(String[] a){var result=new ArrayList<Object>();for(String main:CreationChoice.ORDER)for(String sub:main.equals("druid")?List.of(""):ReleaseClassRoster.visibleSubclassIds(main))for(var form:main.equals("druid")?CreationDruidForm.values():new CreationDruidForm[]{CreationDruidForm.NATURE}){var s=new CharacterCreationScreen();s.choose("Class:"+main);if(!sub.isEmpty())s.choose("Path:"+sub);if(main.equals("druid"))s.choose("Form:"+form.name());var cmd=new UICommandBuilder();s.build(cmd,new UIEventBuilder(),false,false);var values=new HashMap<String,String>();for(var c:cmd.getCommands())if(c.selector!=null&&c.data!=null){var v=JsonParser.parseString(c.data).getAsJsonObject().get("0");if(v.isJsonPrimitive()&&v.getAsJsonPrimitive().isString())values.put(c.selector,v.getAsString());}var cards=new ArrayList<Object>();for(int i=0;i<3;i++)cards.add(Map.of("name",values.get("#Ability"+i+"Name.Text"),"description",values.get("#Ability"+i+".TooltipText")));String id=main.equals("druid")?"druid":sub.equals("steam")?"sol":sub.equals("void_touched")?"void":sub;result.add(Map.of("articleId","class:"+id,"title",s.choice().label(),"form",main.equals("druid")?form.label:"","abilities",cards));}System.out.println(new Gson().toJson(result));}}
'''
with tempfile.TemporaryDirectory(prefix='rift-class-guide-') as tmp:
 f=Path(tmp)/'ClassGuideExport.java';f.write_text(source,encoding='utf-8')
 run=subprocess.run(['C:/Program Files/Java/jdk-25/bin/java.exe','--class-path',str(jar)+os.pathsep+str(server),str(f)],capture_output=True,text=True,encoding='utf-8',check=True)
 data=json.loads(run.stdout.strip().splitlines()[-1])
assert len(data)==11
(SITE/'assets/data/class-abilities.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print('Exported current ability descriptions for 9 class paths / 11 form variants.')
