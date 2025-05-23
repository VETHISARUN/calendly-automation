const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

async function scrollAndClickTime(page, desiredTime, maxScrolls = 20) {
    const scrollableDiv = await page.$('div[data-component="spot-list"]');
    if (!scrollableDiv) return false;

    for (let i = 0; i < maxScrolls; i++) {
        const buttons = await page.$$('button[data-container="time-button"]');
        
        for (const btn of buttons) {
            try {
                const timeElement = await btn.$('div.vXODG3JdP3dNSMN_2yKi');
                if (timeElement) {
                    const timeText = await page.evaluate(el => el.textContent.trim().toLowerCase(), timeElement);
                    if (timeText === desiredTime.toLowerCase()) {
                        await page.evaluate(el => el.scrollIntoView({ block: 'center' }), btn);
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await btn.click();
                        console.log(`Clicked time slot: ${desiredTime}`);
                        return true;
                    }
                }
            } catch (error) {
                continue;
            }
        }
        
        await page.evaluate(div => {
            div.scrollTop += div.offsetHeight;
        }, scrollableDiv);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
}

async function automateCalendly({
    calendlyUrl,
    targetMonth,
    targetDay,
    desiredTime,
    fullName,
    email,
    guestEmails = [],
    note = ''
}) {
    let browser, page;
    
    try {
        // Launch browser with Railway-compatible settings
        browser = await puppeteer.launch({ 
            headless: true, // Must be true for Railway
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });
        
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.goto(calendlyUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        console.log('Page loaded successfully');

        // STEP 1: Close cookie popup
        try {
            const cookieBtn = await page.waitForSelector('.onetrust-close-btn-handler', { timeout: 5000 });
            await cookieBtn.click();
            console.log('Closed cookie popup');
        } catch (error) {
            console.log('Cookie popup not found or already closed');
        }

        // STEP 2: Navigate to target month
        while (true) {
            try {
                await page.waitForSelector('[data-testid="title"]', { timeout: 10000 });
                
                const currentMonth = await page.$eval('[data-testid="title"]', el => el.textContent.trim());
                console.log(`Current month: ${currentMonth}`);

                if (currentMonth === targetMonth) {
                    console.log('Reached target month');
                    break;
                }

                const nextBtn = await page.$('button[aria-label="Go to next month"]');
                if (!nextBtn) {
                    throw new Error('Next button not found');
                }

                const isDisabled = await page.evaluate(btn => btn.disabled, nextBtn);
                if (isDisabled) {
                    throw new Error('Reached end — no more months available');
                }

                await nextBtn.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                throw new Error(`Error navigating months: ${error.message}`);
            }
        }

        // STEP 3: Wait for calendar and click target day
        try {
            await page.waitForSelector("table[aria-label='Select a Day']", { timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('Calendar grid loaded');
        } catch (error) {
            throw new Error('Calendar grid not found');
        }

        let dayClicked = false;
        const dayButtons = await page.$$("table[aria-label='Select a Day'] button");

        for (const btn of dayButtons) {
            try {
                const daySpan = await btn.$('span');
                if (daySpan) {
                    const dayText = await page.evaluate(span => span.textContent.trim(), daySpan);
                    const isDisabled = await page.evaluate(button => button.disabled, btn);
                    
                    if (dayText === targetDay) {
                        if (isDisabled) {
                            throw new Error(`Day ${targetDay} is not selectable (disabled)`);
                        } else {
                            await btn.click();
                            dayClicked = true;
                            console.log(`Clicked day ${targetDay}`);
                            break;
                        }
                    }
                }
            } catch (error) {
                console.log(`Error checking day: ${error.message}`);
            }
        }

        if (!dayClicked) {
            throw new Error(`Day ${targetDay} not found or not clickable`);
        }

        // STEP 4: Wait for time slots and select time
        try {
            await page.waitForSelector('[data-component="spotpicker-times-list"]', { timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('Time slots loaded');
        } catch (error) {
            throw new Error('Time slots did not load');
        }

        if (!await scrollAndClickTime(page, desiredTime)) {
            throw new Error(`Time slot '${desiredTime}' not found`);
        }

        // STEP 5: Click "Next"
        try {
            await page.waitForSelector('button[aria-label^="Next"]', { timeout: 10000 });
            await page.click('button[aria-label^="Next"]');
            console.log('Clicked Next button');
        } catch (error) {
            throw new Error('Next button not found');
        }

        // STEP 6: Fill form
        try {
            await page.waitForSelector('#full_name_input', { timeout: 10000 });
            await page.type('#full_name_input', fullName);
            
            await page.waitForSelector('#email_input');
            await page.type('#email_input', email);
            
            console.log('Filled name and email');
        } catch (error) {
            throw new Error('Form fields not found');
        }

        // STEP 7: Add guest emails
        if (guestEmails && guestEmails.length > 0) {
            try {
                const addGuestsBtn = await page.evaluateHandle(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.find(btn => btn.textContent.includes('Add Guests'));
                });
                
                if (addGuestsBtn && await addGuestsBtn.asElement()) {
                    await addGuestsBtn.asElement().click();
                    console.log('Clicked Add Guests button');
                    
                    const guestInput = await page.waitForSelector('#invitee_guest_input', { timeout: 5000 });
                    
                    for (const guestEmail of guestEmails) {
                        await guestInput.type(guestEmail);
                        await page.keyboard.press('Enter');
                        console.log(`Added guest: ${guestEmail}`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                } else {
                    console.log('Add Guests button not found');
                }
            } catch (error) {
                console.log('Guest input not found — continuing without guests');
            }
        }

        // STEP 8: Add note
        if (note) {
            try {
                const noteTextarea = await page.waitForSelector('textarea[name="question_0"]', { timeout: 5000 });
                await noteTextarea.type(note);
                console.log('Added note');
            } catch (error) {
                console.log('Note input not found — skipping');
            }
        }

        // STEP 9: Final submit
        try {
            const scheduleBtn = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return buttons.find(btn => btn.textContent.includes('Schedule Event'));
            });
            
            if (scheduleBtn && await scheduleBtn.asElement()) {
                await scheduleBtn.asElement().click();
                console.log('Scheduled event successfully!');
            } else {
                const altBtn = await page.$('button[data-testid="confirm-booking"]');
                if (altBtn) {
                    await altBtn.click();
                    console.log('Scheduled event successfully (alternative button)!');
                } else {
                    const submitBtn = await page.$('button[type="submit"]');
                    if (submitBtn) {
                        await submitBtn.click();
                        console.log('Clicked submit button');
                    } else {
                        throw new Error('No submit button found');
                    }
                }
            }
        } catch (error) {
            throw new Error(`Error clicking Schedule button: ${error.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return {
            success: true,
            message: 'Event scheduled successfully!',
            details: {
                calendlyUrl,
                targetMonth,
                targetDay,
                desiredTime,
                fullName,
                email,
                guestEmails,
                note
            }
        };

    } catch (error) {
        console.error('Automation error:', error.message);
        throw error;
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

// API Routes
app.get('/', (req, res) => {
    res.json({
        message: 'Calendly Automation API',
        version: '1.0.0',
        endpoints: {
            'POST /schedule': 'Schedule a Calendly meeting',
            'GET /health': 'Health check'
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/schedule', async (req, res) => {
    try {
        const {
            calendlyUrl,
            targetMonth,
            targetDay,
            desiredTime,
            fullName,
            email,
            guestEmails,
            note
        } = req.body;

        // Validation
        if (!calendlyUrl || !targetMonth || !targetDay || !desiredTime || !fullName || !email) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['calendlyUrl', 'targetMonth', 'targetDay', 'desiredTime', 'fullName', 'email']
            });
        }

        console.log(`Starting automation for: ${fullName} - ${email}`);
        
        const result = await automateCalendly({
            calendlyUrl,
            targetMonth,
            targetDay,
            desiredTime,
            fullName,
            email,
            guestEmails: guestEmails || [],
            note: note || ''
        });

        res.json(result);

    } catch (error) {
        console.error('API Error:', error.message);
        res.status(500).json({
            error: 'Automation failed',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Calendly Automation API running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
});