const puppeteer = require('puppeteer');

async function safeExit(page, browser, message) {
    console.log(message);
    if (page) await page.close();
    if (browser) await browser.close();
    process.exit(1);
}

async function waitForSelector(page, selector, timeout = 10000) {
    try {
        await page.waitForSelector(selector, { timeout });
        return true;
    } catch (error) {
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

async function automateCalendly() {
    let browser, page;
    
    try {
        // Launch browser
        browser = await puppeteer.launch({ 
            headless: false, // Set to true for production
            defaultViewport: null,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        page = await browser.newPage();
        await page.goto('https://calendly.com/johngvm20/30min', { 
            waitUntil: 'networkidle2' 
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

        // STEP 2: Set target month and year
        const targetMonth = "July 2025";

        // STEP 3: Navigate to target month
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
                    await safeExit(page, browser, 'Next button not found');
                }

                const isDisabled = await page.evaluate(btn => btn.disabled, nextBtn);
                if (isDisabled) {
                    await safeExit(page, browser, 'Reached end — no more months available');
                }

                await nextBtn.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                await safeExit(page, browser, 'Error navigating months: ' + error.message);
            }
        }

        // STEP 4: Set target day
        const targetDay = "9";

        try {
            await page.waitForSelector("table[aria-label='Select a Day']", { timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('Calendar grid loaded');
        } catch (error) {
            await safeExit(page, browser, 'Calendar grid not found');
        }

        // STEP 5: Click correct day
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
                            await safeExit(page, browser, `Day ${targetDay} is not selectable (disabled)`);
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
            await safeExit(page, browser, `Day ${targetDay} not found or not clickable`);
        }

        // STEP 6: Wait for time slots panel
        try {
            await page.waitForSelector('[data-component="spotpicker-times-list"]', { timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('Time slots loaded');
        } catch (error) {
            await safeExit(page, browser, 'Time slots did not load');
        }

        // STEP 7: Scroll and click desired time slot
        const desiredTime = "1:00pm";
        
        if (!await scrollAndClickTime(page, desiredTime)) {
            await safeExit(page, browser, `Time slot '${desiredTime}' not found`);
        }

        // STEP 8: Click "Next"
        try {
            await page.waitForSelector('button[aria-label^="Next"]', { timeout: 10000 });
            await page.click('button[aria-label^="Next"]');
            console.log('Clicked Next button');
        } catch (error) {
            await safeExit(page, browser, 'Next button not found');
        }

        // STEP 9: Fill form
        try {
            await page.waitForSelector('#full_name_input', { timeout: 10000 });
            await page.type('#full_name_input', 'Tester');
            
            await page.waitForSelector('#email_input');
            await page.type('#email_input', 'tester@example.com');
            
            console.log('Filled name and email');
        } catch (error) {
            await safeExit(page, browser, 'Form fields not found');
        }

        // STEP 10: Add guest emails
        const guestEmails = ["guest1@example.com", "guest2@example.com"];
        if (guestEmails.length > 0) {
            try {
                // Find "Add Guests" button by evaluating all buttons
                const addGuestsBtn = await page.evaluateHandle(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.find(btn => btn.textContent.includes('Add Guests'));
                });
                
                if (addGuestsBtn && await addGuestsBtn.asElement()) {
                    await addGuestsBtn.asElement().click();
                    console.log('Clicked Add Guests button');
                    
                    const guestInput = await page.waitForSelector('#invitee_guest_input', { timeout: 5000 });
                    
                    for (const email of guestEmails) {
                        await guestInput.type(email);
                        await page.keyboard.press('Enter');
                        console.log(`Added guest: ${email}`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                } else {
                    console.log('Add Guests button not found');
                }
            } catch (error) {
                console.log('Guest input not found — continuing without guests');
            }
        }

        // STEP 11: Add note
        try {
            const noteTextarea = await page.waitForSelector('textarea[name="question_0"]', { timeout: 5000 });
            await noteTextarea.type('Looking forward to it.');
            console.log('Added note');
        } catch (error) {
            console.log('Note input not found — skipping');
        }

        // STEP 12: Final submit
        try {
            // Find "Schedule Event" button by evaluating all buttons
            const scheduleBtn = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return buttons.find(btn => btn.textContent.includes('Schedule Event'));
            });
            
            if (scheduleBtn && await scheduleBtn.asElement()) {
                await scheduleBtn.asElement().click();
                console.log('Scheduled event successfully!');
            } else {
                // Try alternative selectors
                const altBtn = await page.$('button[data-testid="confirm-booking"]');
                if (altBtn) {
                    await altBtn.click();
                    console.log('Scheduled event successfully (alternative button)!');
                } else {
                    console.log('Schedule Event button not found - trying to find any submit button');
                    const submitBtn = await page.$('button[type="submit"]');
                    if (submitBtn) {
                        await submitBtn.click();
                        console.log('Clicked submit button');
                    } else {
                        await safeExit(page, browser, 'No submit button found');
                    }
                }
            }
        } catch (error) {
            await safeExit(page, browser, 'Error clicking Schedule button: ' + error.message);
        }

        // Wait a bit to see the result
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log('Automation completed successfully!');

    } catch (error) {
        console.error('Unexpected error:', error.message);
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

// Run the automation
automateCalendly().catch(console.error);