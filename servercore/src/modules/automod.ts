import { canExecuteCommand, hasExplicitCommandAllow } from "./command-permissions.js";
import { Client, EmbedBuilder, Events, PermissionFlagsBits, SlashCommandBuilder, type Message } from "discord.js";
import type { createDatabase } from "../database.js";
import { z } from "zod";
type Database = ReturnType<typeof createDatabase>;
const schema = z.object({
  spamEnabled:z.boolean().default(true), linksEnabled:z.boolean().default(false),
  invitesEnabled:z.boolean().default(true), capsEnabled:z.boolean().default(false),
  blockedWords:z.array(z.string().min(1).max(50)).max(50).default([]),
  action:z.enum(["delete","timeout"]).default("delete"),
  timeoutMinutes:z.number().int().min(1).max(1440).default(10),
  maxMessages:z.number().int().min(3).max(10).default(5),
  spamWindowSeconds:z.number().int().min(3).max(30).default(8),
  exemptRoleIds:z.array(z.string().regex(/^\d{17,20}$/)).max(25).default([])
});
type Config=z.infer<typeof schema>;
type Setting={enabled:boolean;config:unknown};
const recent=new Map<string,{at:number;content:string}[]>();
const cooldown=new Map<string,number>();
const defaults=schema.parse({});
export const autoModCommand=new SlashCommandBuilder().setName("automod").setDescription("Konfiguriert die automatische Moderation.")
.addSubcommand(s=>s.setName("konfigurieren").setDescription("Aktiviert und konfiguriert AutoMod.")
.addBooleanOption(o=>o.setName("spam").setDescription("Spam erkennen."))
.addBooleanOption(o=>o.setName("links").setDescription("Externe Links blockieren."))
.addBooleanOption(o=>o.setName("einladungen").setDescription("Discord-Einladungen blockieren."))
.addBooleanOption(o=>o.setName("caps").setDescription("Übermäßige Großschreibung erkennen."))
.addStringOption(o=>o.setName("woerter").setDescription("Gesperrte Wörter, kommagetrennt.").setMaxLength(1000))
.addStringOption(o=>o.setName("aktion").setDescription("Maßnahme.").addChoices({name:"Nachricht löschen",value:"delete"},{name:"Löschen und Timeout",value:"timeout"}))
.addIntegerOption(o=>o.setName("timeout_minuten").setDescription("Timeout-Dauer (1–1440 Minuten).").setMinValue(1).setMaxValue(1440))
.addIntegerOption(o=>o.setName("spam_limit").setDescription("Nachrichtenlimit (3–10).").setMinValue(3).setMaxValue(10))
.addIntegerOption(o=>o.setName("spam_fenster").setDescription("Zeitfenster (3–30 Sekunden).").setMinValue(3).setMaxValue(30)))
.addSubcommand(s=>s.setName("status").setDescription("Zeigt die aktuelle Konfiguration."))
.addSubcommand(s=>s.setName("deaktivieren").setDescription("Deaktiviert AutoMod."));
function exempt(m:Message,c:Config):boolean {
 if(!m.member)return false;
 if(m.member.permissions.has(PermissionFlagsBits.Administrator)||m.member.permissions.has(PermissionFlagsBits.ManageGuild))return true;
 return m.member.roles.cache.some(r=>c.exemptRoleIds.includes(r.id));
}
function detect(m:Message,c:Config,now:number):string|null {
 const content=m.content, lower=content.toLocaleLowerCase("de-DE"), key=m.guildId+":"+m.author.id;
 const entries=(recent.get(key)??[]).filter(x=>x.at>=now-c.spamWindowSeconds*1000);
 entries.push({at:now,content});recent.set(key,entries.slice(-20));
 if(c.spamEnabled&&entries.length>=c.maxMessages)return "Spam / Nachrichtenflut";
 if(c.spamEnabled&&entries.length>=3&&entries.slice(-3).every(x=>x.content.trim().toLowerCase()===content.trim().toLowerCase()))return "Wiederholte Nachricht";
 if(c.invitesEnabled&&/(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i.test(content))return "Discord-Einladung";
 if(c.linksEnabled&&/https?:\/\/\S+/i.test(content))return "Externer Link";
 if(c.capsEnabled){const letters=content.match(/[A-Za-zÄÖÜäöüß]/g)??[],upper=content.match(/[A-ZÄÖÜ]/g)??[];if(letters.length>=12&&upper.length/letters.length>=0.75)return "Übermäßige Großschreibung";}
 const word=c.blockedWords.find(x=>{const escaped=x.replace(/[|\\{}()[\]^$+*?.-]/g,"\\$&");return new RegExp("(^|[^\\p{L}\\p{N}])"+escaped+"([^\\p{L}\\p{N}]|$)","iu").test(lower);});
 return word?"Gesperrtes Wort":null;
}
async function process(m:Message,db:Database):Promise<void>{
 if(!m.guild||m.author.bot||!m.content)return;
 const q=await db.query<Setting>("SELECT enabled,config FROM \"SC_module_settings\" WHERE guild_id=$1 AND module_key='automod'",[m.guild.id]);
 if(!q.rows[0]?.enabled)return;
 const parsed=schema.safeParse(q.rows[0].config??{});if(!parsed.success){console.error("[automod] Ungültige Konfiguration:",m.guild.id,parsed.error.flatten());return;}
 const c=parsed.data;if(exempt(m,c))return;
 const now=Date.now(),violation=detect(m,c,now);if(!violation)return;
 const key=m.guild.id+":"+m.author.id,applyTimeout=c.action==="timeout"&&now-(cooldown.get(key)??0)>=60000;
 try{await m.delete();}catch(error){console.warn("[automod] Löschen fehlgeschlagen:",m.guild.id,m.id,error);return;}
 let timedOut=false;
 if(applyTimeout&&m.member?.moderatable){try{
  await m.member.timeout(c.timeoutMinutes*60000,"ServerCore AutoMod: "+violation);timedOut=true;cooldown.set(key,now);
  await db.query("INSERT INTO \"SC_moderation_cases\" (case_id,guild_id,target_id,moderator_id,action,reason,duration_minutes,expires_at) VALUES (gen_random_uuid(),$1,$2,$3,'timeout',$4,$5,$6)",[m.guild.id,m.author.id,m.client.user.id,"AutoMod: "+violation,c.timeoutMinutes,new Date(now+c.timeoutMinutes*60000)]);
 }catch(error){console.error("[automod] Timeout fehlgeschlagen:",error);}}
 await db.query("INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,NULL,'automod.violation',$2,$3::jsonb)",[m.guild.id,m.author.id,JSON.stringify({rule:violation,action:timedOut?"delete_timeout":"delete",channelId:m.channelId})]);
 if(timedOut)await m.author.send({embeds:[new EmbedBuilder().setColor(0xe65b5b).setTitle("AutoMod: Timeout").setDescription("Deine Nachricht auf **"+m.guild.name+"** wurde wegen **"+violation+"** entfernt. Timeout: "+c.timeoutMinutes+" Minuten.")] }).catch(()=>undefined);
}
export function attachAutoMod(client:Client,db:Database):void {
 client.on(Events.MessageCreate,m=>{void process(m,db).catch(e=>console.error("[automod] Prüfung fehlgeschlagen:",e));});
 client.on(Events.InteractionCreate,async i=>{
  if(!i.isChatInputCommand()||i.commandName!=="automod")return;if(!(await canExecuteCommand(i,db)))return;
  if(!i.guild){await i.reply({content:"Nur auf einem Server verfügbar.",ephemeral:true});return;}
  if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)&&!(await hasExplicitCommandAllow(i,db))){await i.reply({content:"Du benötigst „Server verwalten“.",ephemeral:true});return;}
  const sub=i.options.getSubcommand();
  if(sub==="deaktivieren"){await db.query("INSERT INTO \"SC_module_settings\" (guild_id,module_key,enabled,config,updated_at) VALUES ($1,'automod',FALSE,'{}'::jsonb,NOW()) ON CONFLICT (guild_id,module_key) DO UPDATE SET enabled=FALSE,updated_at=NOW()",[i.guild.id]);await i.reply({content:"AutoMod wurde deaktiviert.",ephemeral:true});return;}
  const row=await db.query<Setting>("SELECT enabled,config FROM \"SC_module_settings\" WHERE guild_id=$1 AND module_key='automod'",[i.guild.id]);
  const parsed=schema.safeParse(row.rows[0]?.config??{}),current=parsed.success?parsed.data:defaults;
  if(sub==="status"){await i.reply({content:"AutoMod: **"+(row.rows[0]?.enabled?"Aktiv":"Deaktiviert")+"**\nSpam: "+(current.spamEnabled?"An":"Aus")+" · Links: "+(current.linksEnabled?"An":"Aus")+" · Einladungen: "+(current.invitesEnabled?"An":"Aus")+" · Caps: "+(current.capsEnabled?"An":"Aus")+"\nWortfilter: "+current.blockedWords.length+" · Aktion: "+current.action,ephemeral:true});return;}
  const raw=i.options.getString("woerter"),words=raw===null?current.blockedWords:[...new Set(raw.split(",").map(x=>x.trim().toLocaleLowerCase("de-DE")).filter(Boolean))];
  if(words.length>50||words.some(x=>x.length>50)){await i.reply({content:"Maximal 50 Wörter mit jeweils höchstens 50 Zeichen.",ephemeral:true});return;}
  const next=schema.parse({...current,spamEnabled:i.options.getBoolean("spam")??current.spamEnabled,linksEnabled:i.options.getBoolean("links")??current.linksEnabled,invitesEnabled:i.options.getBoolean("einladungen")??current.invitesEnabled,capsEnabled:i.options.getBoolean("caps")??current.capsEnabled,blockedWords:words,action:i.options.getString("aktion")??current.action,timeoutMinutes:i.options.getInteger("timeout_minuten")??current.timeoutMinutes,maxMessages:i.options.getInteger("spam_limit")??current.maxMessages,spamWindowSeconds:i.options.getInteger("spam_fenster")??current.spamWindowSeconds});
  await db.query("INSERT INTO \"SC_module_settings\" (guild_id,module_key,enabled,config,updated_at) VALUES ($1,'automod',TRUE,$2::jsonb,NOW()) ON CONFLICT (guild_id,module_key) DO UPDATE SET enabled=TRUE,config=EXCLUDED.config,updated_at=NOW()",[i.guild.id,JSON.stringify(next)]);
  await i.reply({content:"AutoMod wurde gespeichert und **aktiviert**.\nSpam: "+(next.spamEnabled?"An":"Aus")+" · Links: "+(next.linksEnabled?"An":"Aus")+" · Einladungen: "+(next.invitesEnabled?"An":"Aus")+" · Caps: "+(next.capsEnabled?"An":"Aus")+"\nWortfilter: "+next.blockedWords.length+" · Aktion: "+next.action+(next.action==="timeout"?" ("+next.timeoutMinutes+" Min.)":"")+"\n\n**Wichtig:** Im Discord Developer Portal unter Bot → Privileged Gateway Intents muss **Message Content Intent** aktiviert sein.",ephemeral:true});
 });
}