import { AppData, ScheduleEntry, ScheduleVersion } from '../types';

/**
 * Returns the ScheduleVersion active for a given date.
 * If no version is found (e.g. date before first version), returns the earliest version.
 * If multiple versions are active (shouldn't happen with correct logic), returns the latest applicable one.
 */
export const getScheduleVersion = (data: AppData, dateStr: string): ScheduleVersion | null => {
    if (!data.scheduleVersions || data.scheduleVersions.length === 0) {
        // Legacy fallback: If no versions exist, we assume the current 'schedules' array 
        // is the only version, effectively active forever (or until migration).
        // However, the migration logic in App.tsx should prevent this state.
        return null;
    }

    // Sort versions by activeFrom descending (newest first)
    const sortedVersions = [...data.scheduleVersions].sort((a, b) => b.activeFrom.localeCompare(a.activeFrom));

    // Find the first version where activeFrom <= dateStr
    const activeVersion = sortedVersions.find(v => v.activeFrom <= dateStr);

    // If found, return it.
    if (activeVersion) return activeVersion;

    // If date is BEFORE the earliest version (e.g. looking at last year), 
    // we return the EARLIEST version available as a fallback.
    // This assumes the earliest version applies to all past dates.
    return sortedVersions[sortedVersions.length - 1];
};

/**
 * Returns the list of ScheduleEntry applicable for a specific date.
 * Considers time-based versioning.
 */
export const getSchedulesForDate = (data: AppData, dateStr: string): ScheduleEntry[] => {
    const version = getScheduleVersion(data, dateStr);

    if (version) {
        return version.schedules;
    }

    // Fallback for legacy mode (before migration completes or if something goes wrong)
    return data.schedules || [];
};
