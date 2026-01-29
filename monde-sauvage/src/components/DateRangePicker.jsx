import { useState, useEffect } from 'react';
import './DateRangePicker.css';

const DateRangePicker = ({ 
    onDateChange, 
    blockedDates = [], 
    minDate = new Date(),
    initialCheckIn = null,
    initialCheckOut = null 
}) => {
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [checkIn, setCheckIn] = useState(initialCheckIn);
    const [checkOut, setCheckOut] = useState(initialCheckOut);
    const [hoveredDate, setHoveredDate] = useState(null);

    useEffect(() => {
        if (initialCheckIn) setCheckIn(initialCheckIn);
        if (initialCheckOut) setCheckOut(initialCheckOut);
    }, [initialCheckIn, initialCheckOut]);

    const monthNames = [
        'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
        'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
    ];

    const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    // Parse blocked dates into Date objects for comparison
    const blockedDateObjects = blockedDates.map(range => {
        const [startYear, startMonth, startDay] = range.start.split('-');
        const [endYear, endMonth, endDay] = range.end.split('-');
        return {
            start: new Date(parseInt(startYear), parseInt(startMonth) - 1, parseInt(startDay)),
            end: new Date(parseInt(endYear), parseInt(endMonth) - 1, parseInt(endDay))
        };
    });

    const isDateBlocked = (date) => {
        const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        return blockedDateObjects.some(range => {
            const start = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
            // Exclude end date - checkout day is available
            const end = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate() - 1);
            
            return checkDate >= start && checkDate <= end;
        });
    };

    const isDateInPast = (date) => {
        const today = new Date();
        const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        return checkDate < todayDate;
    };

    const isDateBeforeMinDate = (date) => {
        if (!minDate) return false;
        const min = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
        const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        return checkDate < min;
    };

    const hasBlockedDateInRange = (start, end) => {
        if (!start || !end) return false;
        
        const current = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());

        while (current <= endDate) {
            if (isDateBlocked(current)) {
                return true;
            }
            current.setDate(current.getDate() + 1);
        }
        return false;
    };

    const isSameDay = (date1, date2) => {
        if (!date1 || !date2) return false;
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        return d1.getFullYear() === d2.getFullYear() &&
               d1.getMonth() === d2.getMonth() &&
               d1.getDate() === d2.getDate();
    };

    const isInRange = (date) => {
        if (!checkIn || !checkOut) return false;
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const start = new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());
        const end = new Date(checkOut.getFullYear(), checkOut.getMonth(), checkOut.getDate());
        return d > start && d < end;
    };

    const isInHoverRange = (date) => {
        if (!checkIn || checkOut || !hoveredDate) return false;
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const start = new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());
        const hovered = new Date(hoveredDate.getFullYear(), hoveredDate.getMonth(), hoveredDate.getDate());

        if (hovered < start) return false;
        if (hasBlockedDateInRange(start, hovered)) return false;

        return d > start && d < hovered;
    };

    const handleDateClick = (date) => {
        // Create a new date object using the year, month, and day to avoid timezone issues
        const clickedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        // Check if date is disabled
        if (isDateInPast(clickedDate) || isDateBeforeMinDate(clickedDate) || isDateBlocked(clickedDate)) {
            return;
        }

        // Reset if both dates are selected
        if (checkIn && checkOut) {
            setCheckIn(clickedDate);
            setCheckOut(null);
            onDateChange(clickedDate, null);
            return;
        }

        // Set check-in
        if (!checkIn) {
            setCheckIn(clickedDate);
            onDateChange(clickedDate, null);
            return;
        }

        // Set check-out
        if (clickedDate < checkIn) {
            // If clicked date is before check-in, reset and set as new check-in
            setCheckIn(clickedDate);
            setCheckOut(null);
            onDateChange(clickedDate, null);
        } else if (isSameDay(clickedDate, checkIn)) {
            // If same day, do nothing
            return;
        } else {
            // Check if there's a blocked date in the range
            if (hasBlockedDateInRange(checkIn, clickedDate)) {
                // Reset and set new check-in
                setCheckIn(clickedDate);
                setCheckOut(null);
                onDateChange(clickedDate, null);
            } else {
                setCheckOut(clickedDate);
                onDateChange(checkIn, clickedDate);
            }
        }
    };

    const handleDateHover = (date) => {
        if (!checkIn || checkOut) {
            setHoveredDate(null);
            return;
        }

        // Create a new date object using the year, month, and day to avoid timezone issues
        const hovered = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        if (hovered > checkIn && !isDateBlocked(hovered) && !hasBlockedDateInRange(checkIn, hovered)) {
            setHoveredDate(hovered);
        } else {
            setHoveredDate(null);
        }
    };

    const getDaysInMonth = (month, year) => {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();

        const days = [];

        // Add empty cells for days before month starts
        for (let i = 0; i < startingDayOfWeek; i++) {
            days.push(null);
        }

        // Add days of month
        for (let day = 1; day <= daysInMonth; day++) {
            days.push(new Date(year, month, day));
        }

        return days;
    };

    const previousMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
    };

    const nextMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
    };

    const renderMonth = (monthOffset = 0) => {
        const month = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + monthOffset);
        const days = getDaysInMonth(month.getMonth(), month.getFullYear());

        return (
            <div className="date-picker-month" key={monthOffset}>
                <div className="date-picker-month-header">
                    <h3 className="date-picker-month-title">
                        {monthNames[month.getMonth()]} {month.getFullYear()}
                    </h3>
                </div>
                <div className="date-picker-day-names">
                    {dayNames.map(day => (
                        <div key={day} className="date-picker-day-name">
                            {day}
                        </div>
                    ))}
                </div>
                <div className="date-picker-days-grid">
                    {days.map((date, index) => {
                        if (!date) {
                            return <div key={`empty-${index}`} className="date-picker-day empty" />;
                        }

                        const isPast = isDateInPast(date);
                        const isBlocked = isDateBlocked(date);
                        const isDisabled = isPast || isBlocked;
                        const isCheckIn = isSameDay(date, checkIn);
                        const isCheckOut = isSameDay(date, checkOut);
                        const inRange = isInRange(date);
                        const inHoverRange = isInHoverRange(date);
                        const isSelected = isCheckIn || isCheckOut;

                        let dayClasses = 'date-picker-day';
                        if (isDisabled) dayClasses += ' disabled';
                        if (isPast) dayClasses += ' past';
                        if (isBlocked) dayClasses += ' blocked';
                        if (isSelected) dayClasses += ' selected';
                        if (isCheckIn) dayClasses += ' check-in';
                        if (isCheckOut) dayClasses += ' check-out';
                        if (inRange) dayClasses += ' in-range';
                        if (inHoverRange) dayClasses += ' hover-range';

                        return (
                            <button
                                key={index}
                                type="button"
                                className={dayClasses}
                                onClick={() => handleDateClick(date)}
                                onMouseEnter={() => handleDateHover(date)}
                                onMouseLeave={() => setHoveredDate(null)}
                                disabled={isDisabled}
                            >
                                <span className="date-picker-day-number">
                                    {date.getDate()}
                                </span>
                                {isBlocked && <div className="date-picker-strikethrough" />}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="date-range-picker">
            <div className="date-picker-controls">
                <button
                    type="button"
                    onClick={previousMonth}
                    className="date-picker-nav"
                    aria-label="Previous month"
                >
                    ‹
                </button>
                <button
                    type="button"
                    onClick={nextMonth}
                    className="date-picker-nav"
                    aria-label="Next month"
                >
                    ›
                </button>
            </div>
            <div className="date-picker-months">
                {renderMonth(0)}
                {renderMonth(1)}
            </div>
        </div>
    );
};

export default DateRangePicker;
