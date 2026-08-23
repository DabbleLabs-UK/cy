import sharp from 'sharp';
const SRC = 'assets/logo_tighter_square_negative_hue_contrast.png';
const { data, info } = await sharp(SRC).resize(128,128,{fit:'cover'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const px = info.width*info.height;
const buckets = new Map();
function rgb2hsv(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;if(d){if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360;}return[h,mx?d/mx:0,mx];}
for(let i=0;i<px;i++){const o=i*info.channels;const a=info.channels===4?data[o+3]:255;if(a<128)continue;const r=data[o],g=data[o+1],b=data[o+2];const[h,s,v]=rgb2hsv(r,g,b);if(s<0.35||v<0.35)continue;
  const key=`${Math.round(r/16)*16},${Math.round(g/16)*16},${Math.round(b/16)*16}`;const e=buckets.get(key)||{count:0,score:0,r:0,g:0,b:0};e.count++;e.score+=s*v;e.r+=r;e.g+=g;e.b+=b;buckets.set(key,e);}
const hex=(n)=>n.toString(16).padStart(2,'0');
const arr=[...buckets.values()].map(e=>({r:Math.round(e.r/e.count),g:Math.round(e.g/e.count),b:Math.round(e.b/e.count),count:e.count,score:e.score}));
// by score (vividness) and by count (area) - report both
const byScore=[...arr].sort((a,b)=>b.score-a.score).slice(0,6);
const byCount=[...arr].sort((a,b)=>b.count-a.count).slice(0,6);
console.log('TOP BY VIVIDNESS:');byScore.forEach(e=>console.log(`  #${hex(e.r)}${hex(e.g)}${hex(e.b)}  count=${e.count} score=${e.score.toFixed(1)}`));
console.log('TOP BY AREA:');byCount.forEach(e=>console.log(`  #${hex(e.r)}${hex(e.g)}${hex(e.b)}  count=${e.count} score=${e.score.toFixed(1)}`));
