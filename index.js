const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json()); // to parse JSON bodies

async function automateCalendly({ url, targetMonth, targetDay, desiredTime, name, email, guestEmails = [], note }) {
    let browser, page;

    function safeExit(page, browser, message) {
        console.log(message);
        if (page) page.close();
        if (browser) browser.close();
        throw new Error(message); // throw error to abort
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

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
                            await wait(500);
                            await btn.click();
                            console.log(`Clicked time slot: ${desiredTime}`);
                            return true;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }
            await page.evaluate(div => { div.scrollTop += div.offsetHeight; }, scrollableDiv);
            await wait(500);
        }
        return false;
    }

    try {
        browser = await puppeteer.launch({
            headless: true, // always headless on Railway
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });

        page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2' });

        console.log('Page loaded successfully');

        // Close cookie popup if exists
        try {
            const cookieBtn = await page.waitForSelector('.onetrust-close-btn-handler', { timeout: 5000 });
            await cookieBtn.click();
            console.log('Closed cookie popup');
        } catch {}

        // Navigate months until targetMonth
        while (true) {
            const currentMonth = await page.$eval('[data-testid="title"]', el => el.textContent.trim());
            if (currentMonth === targetMonth) break;

            const nextBtn = await page.$('button[aria-label="Go to next month"]');
            if (!nextBtn) safeExit(page, browser, 'Next button not found');

            const isDisabled = await page.evaluate(btn => btn.disabled, nextBtn);
            if (isDisabled) safeExit(page, browser, 'Reached end — no more months available');

            await nextBtn.click();
            await wait(1000);
        }

        // Click target day
        const dayButtons = await page.$$("table[aria-label='Select a Day'] button");
        let dayClicked = false;
        for (const btn of dayButtons) {
            const daySpan = await btn.$('span');
            if (!daySpan) continue;

            const dayText = await page.evaluate(span => span.textContent.trim(), daySpan);
            const isDisabled = await page.evaluate(button => button.disabled, btn);

            if (dayText === targetDay) {
                if (isDisabled) safeExit(page, browser, `Day ${targetDay} is disabled`);
                await btn.click();
                dayClicked = true;
                break;
            }
        }
        if (!dayClicked) safeExit(page, browser, `Day ${targetDay} not found or not clickable`);

        // Wait time slots
        await page.waitForSelector('[data-component="spotpicker-times-list"]', { timeout: 10000 });
        await wait(1000);

        // Click desired time slot
        if (!await scrollAndClickTime(page, desiredTime)) {
            safeExit(page, browser, `Time slot '${desiredTime}' not found`);
        }

        // Click Next button
        await page.waitForSelector('button[aria-label^="Next"]', { timeout: 10000 });
        await page.click('button[aria-label^="Next"]');

        // Fill form
        await page.waitForSelector('#full_name_input', { timeout: 10000 });
        await page.type('#full_name_input', name);

        await page.waitForSelector('#email_input', { timeout: 10000 });
        await page.type('#email_input', email);

        // Add guests if any
        if (guestEmails.length > 0) {
            const addGuestsBtnHandle = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return buttons.find(btn => btn.textContent.includes('Add Guests'));
            });

            if (addGuestsBtnHandle && addGuestsBtnHandle.asElement()) {
                await addGuestsBtnHandle.asElement().click();
                await page.waitForSelector('#invitee_guest_input', { timeout: 5000 });
                const guestInput = await page.$('#invitee_guest_input');

                for (const guestEmail of guestEmails) {
                    await guestInput.type(guestEmail);
                    await page.keyboard.press('Enter');
                    await wait(500);
                }
            }
        }

        // Add note if any
        if (note) {
            try {
                const noteTextarea = await page.waitForSelector('textarea[name="question_0"]', { timeout: 5000 });
                await noteTextarea.type(note);
            } catch {}
        }

        // Click Schedule Event button
        const scheduleBtnHandle = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(btn => btn.textContent.includes('Schedule Event'));
        });

        if (scheduleBtnHandle && scheduleBtnHandle.asElement()) {
            await scheduleBtnHandle.asElement().click();
        } else {
            const altBtn = await page.$('button[data-testid="confirm-booking"]');
            if (altBtn) await altBtn.click();
            else {
                const submitBtn = await page.$('button[type="submit"]');
                if (submitBtn) await submitBtn.click();
                else safeExit(page, browser, 'No submit button found');
            }
        }

        await wait(5000);

        return { success: true, message: 'Event scheduled successfully!' };

    } catch (error) {
        return { success: false, error: error.message };
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

// API endpoint
app.post('/schedule', async (req, res) => {
    const { url, targetMonth, targetDay, desiredTime, name, email, guestEmails, note } = req.body;

    if (!url || !targetMonth || !targetDay || !desiredTime || !name || !email) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const result = await automateCalendly({ url, targetMonth, targetDay, desiredTime, name, email, guestEmails, note });

    if (result.success) {
        res.json({ message: result.message });
    } else {
        res.status(500).json({ error: result.error });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
