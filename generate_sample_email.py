#!/usr/bin/env python3
"""
Sample Email Generator & Dispatcher for Office Time Tracker
Creates a sample HTML monthly attendance report file (`sample_monthly_report.eml`)
and attempts sending via SMTP or Outlook.
"""

import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.generator import Generator

RECIPIENT_EMAIL = "deepakkumar.kc@sagitec.com"

def create_sample_email():
    try:
        import sys
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    msg = MIMEMultipart('alternative')

    msg['Subject'] = "🏢 Office Time Tracker - Sample Monthly Attendance Report"
    msg['From'] = f"Office Tracker <{RECIPIENT_EMAIL}>"
    msg['To'] = RECIPIENT_EMAIL

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }}
            .card {{ max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 25px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }}
            .header {{ border-bottom: 2px solid #6366f1; padding-bottom: 15px; margin-bottom: 20px; }}
            .header h2 {{ color: #6366f1; margin: 0; font-size: 1.4rem; }}
            .stats-grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }}
            .stat-box {{ background: #f1f5f9; padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0; }}
            .stat-number {{ font-size: 1.4rem; font-weight: bold; color: #0f172a; margin-top: 4px; }}
            .stat-label {{ font-size: 0.78rem; color: #64748b; font-weight: 600; text-transform: uppercase; }}
            .table {{ width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 0.9rem; }}
            .table th {{ background: #f8fafc; padding: 10px; border-bottom: 2px solid #e2e8f0; text-align: left; color: #475569; }}
            .table td {{ padding: 10px; border-bottom: 1px solid #f1f5f9; }}
            .badge {{ display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }}
            .badge-lunch {{ background: #fef3c7; color: #d97706; }}
            .badge-end {{ background: #f1f5f9; color: #475569; }}
            .badge-meeting {{ background: #e0e7ff; color: #4338ca; }}
            .footer {{ margin-top: 25px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 0.8rem; color: #94a3b8; text-align: center; }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="header">
                <h2>🏢 Office Time Tracker</h2>
                <span style="font-size: 0.85rem; color: #64748b;">Monthly Attendance & Hours Statement</span>
            </div>

            <p>Hello <strong>Deepak Kumar</strong>,</p>
            <p>Here is your sample monthly attendance summary report for <strong>July 2026</strong>:</p>

            <div class="stats-grid">
                <div class="stat-box">
                    <div class="stat-label">Office Days</div>
                    <div class="stat-number" style="color: #10b981;">12 Days</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Total Hours</div>
                    <div class="stat-number">84h 30m</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">3-Day Goal</div>
                    <div class="stat-number" style="color: #6366f1;">100%</div>
                </div>
            </div>

            <h3 style="font-size: 1.05rem; color: #334155; margin-top: 25px;">Daily Sessions Breakdown</h3>
            <table class="table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Work Mode</th>
                        <th>Hours</th>
                        <th>Reason / Notes</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>2026-07-28</strong></td>
                        <td>Office</td>
                        <td>3h 45m</td>
                        <td><span class="badge badge-lunch">🥪 Lunch Break</span> <span style="color: #64748b; font-size: 0.78rem;">Met team at cafeteria</span></td>
                    </tr>
                    <tr>
                        <td><strong>2026-07-28</strong></td>
                        <td>Office</td>
                        <td>4h 30m</td>
                        <td><span class="badge badge-end">🏁 End of Workday</span></td>
                    </tr>
                    <tr>
                        <td><strong>2026-07-27</strong></td>
                        <td>Office</td>
                        <td>8h 15m</td>
                        <td><span class="badge badge-meeting">🤝 Client Meeting</span> <span style="color: #64748b; font-size: 0.78rem;">Sprint review demo</span></td>
                    </tr>
                </tbody>
            </table>

            <div class="footer">
                Report generated automatically by <strong>Office Time Tracker</strong> for {RECIPIENT_EMAIL}.
            </div>
        </div>
    </body>
    </html>
    """
    msg.attach(MIMEText(html_content, 'html'))

    # Save to local .eml file
    eml_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sample_monthly_report.eml')
    with open(eml_path, 'w', encoding='utf-8') as f:
        gen = Generator(f)
        gen.flatten(msg)

    print(f"✅ Sample email file created at: {eml_path}")

    # Attempt SMTP sending if environment password set
    sender_pass = os.environ.get('SENDER_PASSWORD', '')
    if sender_pass:
        smtp_host = os.environ.get('SMTP_HOST', 'smtp.office365.com')
        smtp_port = int(os.environ.get('SMTP_PORT', 587))
        try:
            server = smtplib.SMTP(smtp_host, smtp_port)
            server.starttls()
            server.login(RECIPIENT_EMAIL, sender_pass)
            server.sendmail(RECIPIENT_EMAIL, [RECIPIENT_EMAIL], msg.as_string())
            server.quit()
            print(f"🚀 Sample email sent directly to inbox: {RECIPIENT_EMAIL}")
        except Exception as e:
            print(f"SMTP Dispatch Note: {e}")
    else:
        print("💡 Note: To send directly to your inbox via Python, set $env:SENDER_PASSWORD='your-app-password'.")
        print(f"📄 You can also double-click `sample_monthly_report.eml` to open and view the email report in Outlook!")

if __name__ == '__main__':
    create_sample_email()
