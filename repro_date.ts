const calculateNewDate = (originalDate: string, oldDay: number, newDay: number): string => {
    let y, m, d;

    // Handle DD/MM/YYYY (common in Brazil/User Locale)
    if (originalDate.includes('/')) {
        [d, m, y] = originalDate.split('/').map(Number);
    } else {
        // Handle YYYY-MM-DD or ISO
        const datePart = originalDate.split('T')[0];
        [y, m, d] = datePart.split('-').map(Number);
    }

    // Validate parsing
    if (!y || !m || !d || isNaN(y) || isNaN(m) || isNaN(d)) {
        console.error("Invalid date format:", originalDate);
        return new Date().toISOString().split('T')[0]; // Fallback to today
    }

    // Month is 0-indexed
    const date = new Date(y, m - 1, d);

    if (isNaN(date.getTime())) return new Date().toISOString().split('T')[0];

    const currentDay = date.getDay();
    const diff = newDay - currentDay;

    // Create new date instance
    const newDateObj = new Date(date);
    newDateObj.setDate(date.getDate() + diff);

    const year = newDateObj.getFullYear();
    const month = String(newDateObj.getMonth() + 1).padStart(2, '0');
    const day = String(newDateObj.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
};

// Test Case from User Report
// Original: 16/02/2026 (Segunda/Monday - Day 1)
// Target Slot: Quinta (Thursday - Day 4)
// User sees: 19/02 (Dropwdown) but 26/02 (Green Text)

const originalDate = "2026-02-16"; // Monday
const originalDay = 1;
const targetDay = 4; // Thursday

console.log("Original Date:", originalDate);
console.log("Target Day:", targetDay);
const calculated = calculateNewDate(originalDate, originalDay, targetDay);
console.log("Calculated Date:", calculated);

// Test Inverse
// Original: 16/02/2026 (Monday - Day 1)
// Target Slot: Sexta (Friday - Day 5) -> User reported 26/02 being shown as Friday?
const targetDayFriday = 5;
const calculatedFriday = calculateNewDate(originalDate, originalDay, targetDayFriday);
console.log("Calculated Date (Friday?):", calculatedFriday);
