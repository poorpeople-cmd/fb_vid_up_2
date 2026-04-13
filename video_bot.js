const puppeteer = require('puppeteer');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios'); // API calls ke liye

// ==========================================
// ⚙️ SETTINGS & ENVIRONMENT VARIABLES
// ==========================================
const TARGET_URL = process.env.TARGET_URL || 'https://dadocric.st/player.php?id=ptvsp';
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || '';

const TITLES_INPUT = process.env.TITLES_LIST || 'Live Match Today,,Watch Full Match DC vs GT';
const DESCS_INPUT = process.env.DESCS_LIST || 'Watch the live action here';
const HASHTAGS = process.env.HASHTAGS || '#IPL2026 #DCvsGT #CricketLovers #LiveMatch';

const WAIT_TIME_MS = 300 * 1000; // 5 minutes wait after each upload
const START_TIME = Date.now();
const RESTART_TRIGGER_MS = (5 * 60 * 60 + 30 * 60) * 1000; 
const END_TIME_LIMIT_MS = (5 * 60 * 60 + 50 * 60) * 1000; 

// 🛡️ CRITICAL LOGIC COUNTERS
let consecutiveLinkFails = 0;
let clipCounter = 1;

// 🇵🇰 PKT TIME FORMATTER
function formatPKT(timestampMs = Date.now()) {
    return new Date(timestampMs).toLocaleString('en-US', {
        timeZone: 'Asia/Karachi', hour12: true, year: 'numeric', month: 'short',
        day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }) + " PKT";
}

// ==========================================
// 🧠 METADATA GENERATOR
// ==========================================
function generateMetadata(clipNum) {
    console.log(`\n[🧠 Metadata] Clip #${clipNum} ke liye unique Title aur Description ban raha hai...`);
    
    const titles = TITLES_INPUT.split(',,').map(t => t.trim()).filter(t => t);
    const descs = DESCS_INPUT.split(',,').map(d => d.trim()).filter(d => d);
    
    const title = titles.length ? titles[Math.floor(Math.random() * titles.length)] : "Live Match Today";
    const descBody = descs.length ? descs[Math.floor(Math.random() * descs.length)] : "Watch the live action here!";
    
    const emojis = ["🔥", "🏏", "⚡", "🏆", "💥", "😱", "📺", "🚀"].sort(() => 0.5 - Math.random()).slice(0, 3);
    const tags = HASHTAGS.split(' ').sort(() => 0.5 - Math.random()).slice(0, 4).join(' ');
    
    const finalTitle = title.substring(0, 240); // Safe limit
    const finalDesc = `${finalTitle} ${emojis.join(' ')}\n\n${descBody}\n\n⏱️ Update: ${formatPKT()}\n👇 Watch Full Match Link in First Comment!\n\n${tags}`;
    
    console.log(`[✅ Metadata] Ready: ${finalTitle}`);
    return { title: finalTitle, desc: finalDesc };
}

// ==========================================
// 🔍 WORKER 0: GET M3U8 LINK & EXPIRE TIME
// ==========================================
async function getStreamData() {
    console.log(`\n[🔍 STEP 1] Puppeteer Chrome Start kar raha hoon... (Strike: ${consecutiveLinkFails}/3)`);
    
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--mute-audio'] 
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let streamData = null;

    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('.m3u8')) {
            const urlObj = new URL(url);
            const expires = urlObj.searchParams.get('expires') || urlObj.searchParams.get('e') || urlObj.searchParams.get('exp');
            let expireMs = expires ? parseInt(expires) * 1000 : Date.now() + (60 * 60 * 1000);

            streamData = {
                url: url, referer: request.headers()['referer'] || TARGET_URL,
                cookie: request.headers()['cookie'] || '', expireTime: expireMs
            };
        }
    });

    try {
        console.log(`[🌐] Target URL par ja raha hoon...`);
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.click('body').catch(() => {});
        console.log(`[⏳] 15 second wait stream load hone ke liye...`);
        await new Promise(r => setTimeout(r, 15000));
    } catch (e) {
        console.log(`[❌ ERROR] Page load nahi ho saka.`);
    }
    
    await browser.close();

    if (streamData) {
        consecutiveLinkFails = 0; 
        console.log(`[✅ BINGO] M3U8 Link pakar liya gaya! Expiry: ${formatPKT(streamData.expireTime)}`);
        return streamData;
    } else {
        consecutiveLinkFails++;
        console.log(`[🚨 WARNING] Link nahi mila. Strike: ${consecutiveLinkFails}/3`);
        if (consecutiveLinkFails >= 3) {
            console.log(`[🛑 FATAL] 3 baar link fail! Bot band kar raha hoon.`);
            process.exit(1); 
        }
        return null;
    }
}

// ==========================================
// 📸 WORKER 0.5: GENERATE THUMBNAIL (PUPPETEER)
// ==========================================

// ==========================================
// 📸 WORKER 0.5: GENERATE THUMBNAIL (PUPPETEER)
// ==========================================
async function worker_0_5_generate_thumbnail(data, titleText, outputImagePath) {
    console.log(`\n[🎨 Worker 0.5] Puppeteer se HD Thumbnail bana raha hoon...`);
    
    // Step A: Capture a single frame from stream using FFmpeg
    const rawFrame = 'temp_raw_frame.jpg';
    console.log(`[>] Stream se 1 frame capture kar raha hoon...`);
    try {
        const headersCmd = `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\nReferer: ${data.referer}\r\nCookie: ${data.cookie}\r\n`;
        execSync(`ffmpeg -y -headers "${headersCmd}" -i "${data.url}" -vframes 1 -q:v 2 ${rawFrame}`, { stdio: 'ignore' });
    } catch (e) {
        console.log(`[❌ Worker 0.5] Frame capture fail!`);
        return false;
    }

    if (!fs.existsSync(rawFrame)) return false;

    // Convert frame to Base64
    const b64Image = "data:image/jpeg;base64," + fs.readFileSync(rawFrame).toString('base64');
    
    const htmlCode = `
        <!DOCTYPE html><html><head>
        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@700;900&display=swap" rel="stylesheet">
        <style>
            body { margin: 0; width: 1280px; height: 720px; background: #0f0f0f; font-family: 'Roboto', sans-serif; color: white; display: flex; flex-direction: column; overflow: hidden; }
            .header { height: 100px; display: flex; align-items: center; padding: 0 40px; justify-content: space-between; z-index: 10; }
            .logo { font-size: 50px; font-weight: 900; letter-spacing: 1px; text-shadow: 0 0 10px rgba(255,255,255,0.8); }
            .live-badge { border: 4px solid #cc0000; border-radius: 12px; padding: 5px 20px; font-size: 40px; font-weight: 700; display: flex; gap: 10px; }
            .hero-container { position: relative; width: 100%; height: 440px; }
            .hero-img { width: 100%; height: 100%; object-fit: cover; filter: blur(5px); opacity: 0.6; }
            .pip-img { position: absolute; top: 20px; right: 40px; width: 45%; border: 6px solid white; box-shadow: -15px 15px 30px rgba(0,0,0,0.8); }
            .text-container { flex-grow: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 10px 40px; }
            .main-title { font-size: 70px; font-weight: 900; line-height: 1.1; text-shadow: 6px 6px 15px rgba(0,0,0,0.9); }
            .live-text { color: #cc0000; }
        </style>
        </head><body>
            <div class="header">
                <div class="logo">SPORTSHUB</div>
                <div class="live-badge"><span style="color:#cc0000">●</span> LIVE</div>
            </div>
            <div class="hero-container">
                <img src="${b64Image}" class="hero-img">
                <img src="${b64Image}" class="pip-img">
            </div>
            <div class="text-container">
                <div class="main-title"><span class="live-text">LIVE NOW: </span>${titleText}</div>
            </div>
        </body></html>
    `;

    console.log(`[>] Browser mein HTML render kar ke screenshot le raha hoon...`);
    
    // 🛠️ YAHAN FIX KIYA GAYA HAI: --no-sandbox aur --disable-setuid-sandbox add kar diya hai
    const browser = await puppeteer.launch({ 
        headless: true, 
        defaultViewport: { width: 1280, height: 720 },
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlCode);
    await page.screenshot({ path: outputImagePath });
    await browser.close();

    if (fs.existsSync(rawFrame)) fs.unlinkSync(rawFrame); // Cleanup
    console.log(`[✅ Worker 0.5] Thumbnail Ready: ${outputImagePath}`);
    return true;
}




// async function worker_0_5_generate_thumbnail(data, titleText, outputImagePath) {
//     console.log(`\n[🎨 Worker 0.5] Puppeteer se HD Thumbnail bana raha hoon...`);
    
//     // Step A: Capture a single frame from stream using FFmpeg
//     const rawFrame = 'temp_raw_frame.jpg';
//     console.log(`[>] Stream se 1 frame capture kar raha hoon...`);
//     try {
//         const headersCmd = `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\nReferer: ${data.referer}\r\nCookie: ${data.cookie}\r\n`;
//         execSync(`ffmpeg -y -headers "${headersCmd}" -i "${data.url}" -vframes 1 -q:v 2 ${rawFrame}`, { stdio: 'ignore' });
//     } catch (e) {
//         console.log(`[❌ Worker 0.5] Frame capture fail!`);
//         return false;
//     }

//     if (!fs.existsSync(rawFrame)) return false;

//     // Convert frame to Base64
//     const b64Image = "data:image/jpeg;base64," + fs.readFileSync(rawFrame).toString('base64');
    
//     const htmlCode = `
//         <!DOCTYPE html><html><head>
//         <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@700;900&display=swap" rel="stylesheet">
//         <style>
//             body { margin: 0; width: 1280px; height: 720px; background: #0f0f0f; font-family: 'Roboto', sans-serif; color: white; display: flex; flex-direction: column; overflow: hidden; }
//             .header { height: 100px; display: flex; align-items: center; padding: 0 40px; justify-content: space-between; z-index: 10; }
//             .logo { font-size: 50px; font-weight: 900; letter-spacing: 1px; text-shadow: 0 0 10px rgba(255,255,255,0.8); }
//             .live-badge { border: 4px solid #cc0000; border-radius: 12px; padding: 5px 20px; font-size: 40px; font-weight: 700; display: flex; gap: 10px; }
//             .hero-container { position: relative; width: 100%; height: 440px; }
//             .hero-img { width: 100%; height: 100%; object-fit: cover; filter: blur(5px); opacity: 0.6; }
//             .pip-img { position: absolute; top: 20px; right: 40px; width: 45%; border: 6px solid white; box-shadow: -15px 15px 30px rgba(0,0,0,0.8); }
//             .text-container { flex-grow: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 10px 40px; }
//             .main-title { font-size: 70px; font-weight: 900; line-height: 1.1; text-shadow: 6px 6px 15px rgba(0,0,0,0.9); }
//             .live-text { color: #cc0000; }
//         </style>
//         </head><body>
//             <div class="header">
//                 <div class="logo">SPORTSHUB</div>
//                 <div class="live-badge"><span style="color:#cc0000">●</span> LIVE</div>
//             </div>
//             <div class="hero-container">
//                 <img src="${b64Image}" class="hero-img">
//                 <img src="${b64Image}" class="pip-img">
//             </div>
//             <div class="text-container">
//                 <div class="main-title"><span class="live-text">LIVE NOW: </span>${titleText}</div>
//             </div>
//         </body></html>
//     `;

//     console.log(`[>] Browser mein HTML render kar ke screenshot le raha hoon...`);
//     const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 720 } });
//     const page = await browser.newPage();
//     await page.setContent(htmlCode);
//     await page.screenshot({ path: outputImagePath });
//     await browser.close();

//     if (fs.existsSync(rawFrame)) fs.unlinkSync(rawFrame); // Cleanup
//     console.log(`[✅ Worker 0.5] Thumbnail Ready: ${outputImagePath}`);
//     return true;
// }



// ==========================================
// 🎥 WORKER 1 & 2: CAPTURE & FAST EDIT (RAW FFMPEG)
// ==========================================
async function worker_1_2_capture_and_edit(data, outputVid) {
    console.log(`\n[🎬 Worker 1 & 2] Stream capture aur Fast Edit shuru ho raha hai...`);
    
    // MoviePy slow tha, hum direct FFmpeg se video ko Blur aur Audio add karenge!
    const headersCmd = `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\nReferer: ${data.referer}\r\nCookie: ${data.cookie}\r\n`;
    const audioFile = "marya_live.mp3";
    const duration = 10; 

    // FFmpeg Logic: Capture 10s, Scale to 720p, Apply BoxBlur, Add Custom Audio.
    let ffmpegCmd = `ffmpeg -y -headers "${headersCmd}" -i "${data.url}"`;
    
    if (fs.existsSync(audioFile)) {
        console.log(`[>] Custom audio mil gaya. Video mute karke nayi audio laga raha hoon...`);
        ffmpegCmd += ` -stream_loop -1 -i ${audioFile} -c:v libx264 -preset ultrafast -vf "scale=1280:720,boxblur=10:1" -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -t ${duration} "${outputVid}"`;
    } else {
        console.log(`[⚠️] Custom audio nahi mili. Original audio ke sath process kar raha hoon...`);
        ffmpegCmd += ` -c:v libx264 -preset ultrafast -vf "scale=1280:720,boxblur=10:1" -c:a aac -t ${duration} "${outputVid}"`;
    }

    try {
        console.log(`[>] Executing FFmpeg Fast-Edit Engine...`);
        execSync(ffmpegCmd, { stdio: 'ignore' });
        
        if (fs.existsSync(outputVid)) {
            console.log(`[✅ Worker 1 & 2] Video Edit aur Save ho gayi: ${outputVid}`);
            return true;
        }
    } catch (e) {
        console.log(`[❌ Worker 1 & 2] FFmpeg processing crash ho gayi!`);
    }
    return false;
}

// ==========================================
// 📤 WORKER 3: FACEBOOK UPLOAD
// ==========================================
async function worker_3_upload(videoPath, thumbPath, title, desc) {
    console.log(`\n[📤 Worker 3] Facebook Page par Video Upload kar raha hoon...`);
    
    try {
        // Step 1: Get Page ID
        const meRes = await axios.get(`https://graph.facebook.com/v18.0/me?access_token=${FB_ACCESS_TOKEN}&fields=id,name`);
        const pageId = meRes.data.id;
        console.log(`[✅ FB Auth] Connected to Page: ${meRes.data.name}`);

        // Step 2: Prepare Multipart Form Data
        const form = new FormData();
        form.append('access_token', FB_ACCESS_TOKEN);
        form.append('title', title);
        form.append('description', desc);
        form.append('source', fs.createReadStream(videoPath));
        if (fs.existsSync(thumbPath)) {
            form.append('thumb', fs.createReadStream(thumbPath));
        }

        // Step 3: Upload Video
        console.log(`[>] Uploading Video (Yeh thora time le sakta hai)...`);
        const uploadRes = await axios.post(`https://graph-video.facebook.com/v18.0/${pageId}/videos`, form, {
            headers: form.getHeaders()
        });

        const videoId = uploadRes.data.id;
        console.log(`[✅ Worker 3] Video Upload SUCCESS! Post ID: ${videoId}`);

        // Step 4: Drop Comment
        console.log(`[⏳] 15 seconds wait for FB to process...`);
        await new Promise(r => setTimeout(r, 15000));
        
        console.log(`[>] Dropping promotional comment...`);
        const commentForm = new FormData();
        commentForm.append('access_token', FB_ACCESS_TOKEN);
        commentForm.append('message', '📺 Watch Full Match Without Buffering Here: https://bulbul4u-live.xyz');
        
        if (fs.existsSync("comment_image.jpeg")) {
            commentForm.append('source', fs.createReadStream("comment_image.jpeg"));
        }
        
        await axios.post(`https://graph.facebook.com/v18.0/${videoId}/comments`, commentForm, { headers: commentForm.getHeaders() });
        console.log(`[✅ Worker 3] Promotional Comment Placed!`);
        return true;

    } catch (e) {
        console.log(`[❌ Worker 3] Facebook API Error: ${e.response ? JSON.stringify(e.response.data) : e.message}`);
        return false;
    }
}

// ==========================================
// 🔄 GITHUB AUTO-RESTART
// ==========================================
async function triggerNextRun() {
    console.log(`\n[⏰ Relay Race] Time limit approach ho rahi hai! Naya GitHub Action chala raha hoon...`);
    const token = process.env.GH_PAT;
    const repo = process.env.GITHUB_REPOSITORY;
    const branch = process.env.GITHUB_REF_NAME || 'main';

    if (!token || !repo) {
        console.log(`[❌] GH_PAT ya GITHUB_REPOSITORY missing hai!`);
        return;
    }

    try {
        await axios.post(`https://api.github.com/repos/${repo}/actions/workflows/video_loop.yml/dispatches`, {
            ref: branch,
            inputs: {
                target_url: TARGET_URL, titles_list: TITLES_INPUT, descs_list: DESCS_INPUT, hashtags: HASHTAGS
            }
        }, {
            headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        console.log(`[✅ Relay Race] Naya Bot background mein start ho gaya!`);
    } catch (e) {
        console.log(`[❌ Relay Race] Trigger failed!`);
    }
}

// ==========================================
// 🚀 MAIN HYBRID LOOP (THE BRAIN)
// ==========================================
async function main() {
    console.log("\n==================================================");
    console.log(`   🚀 ULTIMATE NODE.JS HYBRID VIDEO BOT`);
    console.log(`   ⏰ STARTED AT: ${formatPKT()}`);
    console.log("==================================================");

    let streamData = await getStreamData();
    if (!streamData) return;

    let nextRunTriggered = false;

    while (true) {
        const elapsedTimeMs = Date.now() - START_TIME;
        
        console.log(`\n--------------------------------------------------`);
        console.log(`--- 🔄 STARTING VIDEO CYCLE #${clipCounter} ---`);
        console.log(`  [-] Bot Uptime: ${Math.floor(elapsedTimeMs / 60000)} minutes`);
        console.log(`--------------------------------------------------`);

        // Check Lifespan limits
        if (elapsedTimeMs > RESTART_TRIGGER_MS && !nextRunTriggered) {
            await triggerNextRun();
            nextRunTriggered = true;
        }

        if (elapsedTimeMs > END_TIME_LIMIT_MS) {
            console.log(`\n[🛑 System] 6 Ghante ki limit poori. Graceful exit.`);
            process.exit(0);
        }

        // Check Link Expiry
        if (streamData.expireTime - Date.now() < 120000) { // 2 mins baqi hain
            console.log(`[🚨] Link expire hone wala hai! Naya link la raha hoon...`);
            let newData = await getStreamData();
            if (newData) streamData = newData;
            else {
                console.log(`[⚠️] Link swap fail. 1 minute baad dobara try karunga...`);
                await new Promise(r => setTimeout(r, 60000));
                continue;
            }
        }

        // Action Flow
        const meta = generateMetadata(clipCounter);
        const thumbFile = `studio_thumb_${clipCounter}.png`;
        const finalVidFile = `final_${clipCounter}.mp4`;

        console.log(`\n[⚡ Flow] Worker Pipeline Start kar raha hoon...`);
        
        const thumbOk = await worker_0_5_generate_thumbnail(streamData, meta.title, thumbFile);
        if (thumbOk) {
            const vidOk = await worker_1_2_capture_and_edit(streamData, finalVidFile);
            if (vidOk) {
                await worker_3_upload(finalVidFile, thumbFile, meta.title, meta.desc);
            }
        }

        // Cleanup
        console.log(`\n[🧹 Cleanup] Temporary files delete kar raha hoon...`);
        [thumbFile, finalVidFile].forEach(f => {
            if (fs.existsSync(f)) { fs.unlinkSync(f); console.log(`  [-] Deleted: ${f}`); }
        });

        console.log(`\n[⏳ Cycle End] Cycle #${clipCounter} Mukammal! Aglay action tak 5 minute wait kar raha hoon...`);
        clipCounter++;
        await new Promise(r => setTimeout(r, WAIT_TIME_MS));
    }
}

// Start The Bot
main();
