try {
    $outlook = New-Object -ComObject Outlook.Application
    $mail = $outlook.CreateItem(0)
    $mail.To = "deepakkumar.kc@sagitec.com"
    $mail.Subject = "🏢 Office Time Tracker - Sample Monthly Attendance Report"
    $mail.HTMLBody = @"
    <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #6366f1; margin-top: 0;">🏢 Office Time Tracker - Monthly Summary Report</h2>
        <p>Hello <strong>Deepak Kumar</strong>,</p>
        <p>This is a sample automated monthly attendance report generated for your account:</p>
        
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #cbd5e1;">
            <p style="margin: 5px 0;">📅 <strong>Month:</strong> July 2026</p>
            <p style="margin: 5px 0;">🏢 <strong>Total Office Days Logged:</strong> 12 Days</p>
            <p style="margin: 5px 0;">⏱️ <strong>Total Hours Spent:</strong> 84 Hours 30 Minutes</p>
            <p style="margin: 5px 0;">🎯 <strong>3-Day Weekly Target:</strong> <span style="color: #10b981; font-weight: bold;">100% Achieved</span></p>
        </div>

        <h3>Sample Daily Session Breakdown</h3>
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
            <thead>
                <tr style="background-color: #f1f5f9; color: #475569;">
                    <th style="padding: 8px; border-bottom: 2px solid #cbd5e1;">Date</th>
                    <th style="padding: 8px; border-bottom: 2px solid #cbd5e1;">Mode</th>
                    <th style="padding: 8px; border-bottom: 2px solid #cbd5e1;">Duration</th>
                    <th style="padding: 8px; border-bottom: 2px solid #cbd5e1;">Break Reason</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">2026-07-28</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Office</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">3h 45m</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">🥪 Lunch Break</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">2026-07-28</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Office</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">4h 15m</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">🏁 End of Workday</td>
                </tr>
            </tbody>
        </table>

        <p style="font-size: 12px; color: #64748b; margin-top: 25px;">
            Sent automatically by your local <strong>Office Time Tracker</strong> service.
        </p>
    </div>
"@
    $mail.Send()
    Write-Output "SUCCESS: Sample email sent directly to deepakkumar.kc@sagitec.com via Outlook!"
} catch {
    Write-Output "OUTLOOK_NOT_RUNNING: $_"
}
