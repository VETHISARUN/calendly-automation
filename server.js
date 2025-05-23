// server.js
const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

async function safeExit(page, browser, message) {
    console.log(message);
    if (page) await page.close();
    if (browser) await browser.close();
    return { success: false, message };
}

async function waitForSelector(page, selector, timeout = 10000) {
    try {
        await page.waitForSelector(selector, { timeout });
        return true;
    } catch {
        return false;
    }
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
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await btn.click();
                        return true;
                    }
                }
            } catch { continue; }
        }
        await page.evaluate(div => div.scrollTop += div.offsetHeight, scrollableDiv);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
}

async function automateCalendly() {
    let browser, page;

    try {
        browser = await puppeteer.launch({
            headless: true,
            defaultViewport: null,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        page = await browser.newPage();
        await page.goto('https://calendly.com/johngvm20/30min', { waitUntil: 'networkidle2' });

        // Close cookie popup
        try {
            const cookieBtn = await page.waitForSelector('.onetrust-close-btn-handler', { timeout: 5000 });
            await cookieBtn.click();
        } catch {}

        const targetMonth = "July 2025";
        const targetDay = "9";
        const desiredTime = "1:00pm";

        // Navigate to month
        while (true) {
            await page.waitForSelector('[data-testid="title"]', { timeout: 10000 });
            const currentMonth = await page.$eval('[data-testid="title"]', el => el.textContent.trim());
            if (currentMonth === targetMonth) break;

            const nextBtn = await page.$('button[aria-label="Go to next month"]');
            const isDisabled = await page.evaluate(btn => btn.disabled, nextBtn);
            if (isDisabled) return await safeExit(page, browser, 'Reached end — no more months');

            await nextBtn.click();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Click target day
        await page.waitForSelector("table[aria-label='Select a Day']");
        const dayButtons = await page.$$("table[aria-label='Select a Day'] button");
        let clicked = false;

        for (const btn of dayButtons) {
            const daySpan = await btn.$('span');
            const dayText = await page.evaluate(el => el.textContent.trim(), daySpan);
            const isDisabled = await page.evaluate(el => el.disabled, btn);
            if (dayText === targetDay && !isDisabled) {
                await btn.click();
                clicked = true;
                break;
            }
        }

        if (!clicked) return await safeExit(page, browser, `Day ${targetDay} not found`);

        await page.waitForSelector('[data-component="spotpicker-times-list"]');
        if (!await scrollAndClickTime(page, desiredTime))
            return await safeExit(page, browser, `Time slot '${desiredTime}' not found`);

        await page.waitForSelector('button[aria-label^="Next"]');
        await page.click('button[aria-label^="Next"]');

        await page.waitForSelector('#full_name_input');
        await page.type('#full_name_input', 'Tester');
        await page.type('#email_input', 'tester@example.com');

        const guestEmails = ["guest1@example.com", "guest2@example.com"];
        const addGuestsBtn = await page.evaluateHandle(() => {
            return Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Add Guests'));
        });
        if (addGuestsBtn && await addGuestsBtn.asElement()) {
            await addGuestsBtn.asElement().click();
            const guestInput = await page.waitForSelector('#invitee_guest_input');
            for (const email of guestEmails) {
                await guestInput.type(email);
                await page.keyboard.press('Enter');
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        try {
            const noteTextarea = await page.waitForSelector('textarea[name="question_0"]', { timeout: 5000 });
            await noteTextarea.type('Looking forward to it.');
        } catch {}

        const scheduleBtn = await page.evaluateHandle(() => {
            return Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Schedule Event'));
        });
        if (scheduleBtn && await scheduleBtn.asElement()) {
            await scheduleBtn.asElement().click();
        } else {
            const altBtn = await page.$('button[data-testid="confirm-booking"]');
            if (altBtn) await altBtn.click();
            else {
                const submitBtn = await page.$('button[type="submit"]');
                if (submitBtn) await submitBtn.click();
                else return await safeExit(page, browser, 'No submit button found');
            }
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
        return { success: true, message: "Scheduled successfully" };

    } catch (error) {
        return { success: false, message: error.message };
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

app.get('/schedule', async (req, res) => {
    const result = await automateCalendly();
    res.json(result);
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
