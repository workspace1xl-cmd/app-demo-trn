import math
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Activity, Certificate, Department, Enrollment, MistakeRegisterEntry, OnboardingStage, OnboardingStageItem, OrgPreboardingContent, Organization, QuizQuestion, ReadinessSnapshot, TrainingModule, User
from .security import hash_password


MODULES = [
    ("TRN-01", "Welcome to the Organisation", "Understand the organisation, its history and how it creates value", 8),
    ("TRN-02", "Vision, Mission & Core Values", "Connect daily decisions to the organisation's direction", 10),
    ("TRN-03", "Leadership & Organisation Structure", "Know leaders, departments and reporting routes", 9),
    ("TRN-04", "Culture, Conduct & Expected Behaviour", "Apply workplace standards in realistic situations", 12),
    ("TRN-05", "Code of Ethics", "Recognise conflicts, misconduct and speak-up routes", 12),
    ("TRN-06", "Information Security & Confidentiality", "Protect accounts, devices, data and confidential information", 18),
    ("TRN-07", "Data Privacy & Compliance", "Handle personal and regulated data lawfully", 15),
    ("TRN-08", "Communication Etiquette", "Use email, WhatsApp, phone and meetings professionally", 16),
    ("TRN-09", "HR & Office Policies", "Find and acknowledge current policies", 12),
    ("TRN-10", "Leave & Attendance", "Use the approved leave and attendance process", 11),
    ("TRN-11", "Expenses & Reimbursement", "Submit complete and timely claims", 10),
    ("TRN-12", "Asset Allocation, Use & Return", "Request, protect and return company assets", 14),
    ("TRN-13", "IT Support & Access", "Use tickets, priority rules and access approval", 12),
    ("TRN-14", "Procurement & Vendor Onboarding", "Follow purchasing and due-diligence controls", 15),
    ("TRN-15", "Escalation Matrix", "Escalate with evidence through the hierarchy", 10),
    ("TRN-16", "Performance Reviews", "Prepare goals, evidence and development actions", 12),
    ("TRN-17", "Learning & Development", "Use role pathways, mentoring and learning opportunities", 8),
    ("TRN-18", "Employee Benefits", "Understand eligibility, enrolment and support", 9),
    ("TRN-19", "Ownership, Task Closure & Handover", "Close work with evidence and accountability", 14),
    ("TRN-20", "Document & Records Discipline", "Name, approve, store and retain records correctly", 13),
    ("TRN-21", "Meetings & Collaboration", "Run purposeful meetings with owners and due dates", 10),
    ("TRN-22", "Frequently Asked Questions", "Resolve common operational questions independently", 8),
]

# BUILD PROMPT v5 item A2: named owners on ~85% of rows, ~15% deliberately
# left as the unassigned placeholder so the ownership-gap detection has a
# believable minority to actually flag — every row unassigned (the
# previous seed) made 100% of nodes read as broken rather than honest.
# (name, department, role, contact, sla, escalation_1, escalation_2, sop,
#  module, current_person or None, backup_person or None)
ACTIVITIES = [
    ("Applying for Leave", "Human Resources", "HR Executive", "hr-helpdesk@company.com", "2 business days", "HR Manager", "Head of HR", "SOP-01", "TRN-10", "Meera Krishnan", "Ritika Bose"),
    ("Attendance Regularisation", "Human Resources", "HR Executive", "hr-helpdesk@company.com", "2 business days", "HR Manager", "Head of HR", "SOP-01", "TRN-10", "Meera Krishnan", "Ritika Bose"),
    ("Payroll Query", "Human Resources", "Payroll Specialist", "payroll@company.com", "3 business days", "HR Manager", "Head of HR", "SOP-06", "TRN-09", "Arjun Malhotra", "Meera Krishnan"),
    ("Employee Referral", "Human Resources", "Talent Acquisition Lead", "careers@company.com", "5 business days", "HR Manager", "Head of HR", "SOP-09", "TRN-03", "Ritika Bose", "Meera Krishnan"),
    ("Exit Process & Asset Return", "Human Resources", "HR Operations Lead", "hr-helpdesk@company.com", "As per notice", "HR Manager", "Head of HR", "SOP-05", "TRN-12", None, None),
    ("Laptop / Asset Request", "Information Technology", "IT Asset Coordinator", "it-support@company.com", "3 business days", "IT Manager", "Head of IT", "SOP-02", "TRN-12", "Karan Mehta", "Sneha Iyer"),
    ("Damaged Equipment", "Information Technology", "IT Service Desk", "it-support@company.com", "4 business hours", "IT Manager", "Head of IT", "SOP-03", "TRN-13", "Sneha Iyer", "Karan Mehta"),
    ("IT Support Ticket", "Information Technology", "IT Support Engineer", "it-support@company.com", "1 business day", "IT Manager", "Head of IT", "SOP-03", "TRN-13", "Karan Mehta", "Sneha Iyer"),
    ("New Software Access", "Information Technology", "IT Administrator", "it-support@company.com", "2 business days", "IT Manager", "Head of IT", "SOP-04", "TRN-13", "Sneha Iyer", "Karan Mehta"),
    ("Password / Email Issue", "Information Technology", "IT Service Desk", "it-support@company.com", "4 business hours", "IT Manager", "Head of IT", "SOP-03", "TRN-06", None, None),
    ("Expense Reimbursement", "Finance", "Accounts Payable Specialist", "expenses@company.com", "Next pay cycle", "Finance Manager", "CFO", "SOP-10", "TRN-11", "Vikram Rao", "Neha Kapoor"),
    ("Finance Approval", "Finance", "Finance Business Partner", "finance@company.com", "3 business days", "Finance Manager", "CFO", "SOP-07", "TRN-11", "Neha Kapoor", "Vikram Rao"),
    ("Purchase Request", "Procurement", "Procurement Executive", "procurement@company.com", "5 business days", "Procurement Manager", "COO", "SOP-07", "TRN-14", "Devika Suresh", "Neha Kapoor"),
    ("Vendor Onboarding", "Procurement", "Vendor Management Lead", "vendors@company.com", "10 business days", "Procurement Manager", "COO", "SOP-08", "TRN-14", "Devika Suresh", "Vikram Rao"),
    ("Travel Approval", "Administration", "Travel Coordinator", "travel@company.com", "3 business days", "Admin Manager", "COO", "SOP-11", "TRN-09", "Farhan Sheikh", "Devika Suresh"),
    ("Meeting Room Booking", "Administration", "Facilities Coordinator", "facilities@company.com", "Same day", "Admin Manager", "COO", "SOP-12", "TRN-21", "Farhan Sheikh", "Devika Suresh"),
    ("Visitor Management", "Administration", "Front Office Executive", "reception@company.com", "1 business day", "Admin Manager", "COO", "SOP-13", "TRN-09", "Ananya Das", "Farhan Sheikh"),
    ("ID / Visiting Card Request", "Administration", "Admin Executive", "admin@company.com", "5 business days", "Admin Manager", "COO", "SOP-14", "TRN-09", "Ananya Das", "Farhan Sheikh"),
    ("Contract / Legal Approval", "Legal & Compliance", "Legal Counsel", "legal@company.com", "7 business days", "Legal Manager", "General Counsel", "SOP-15", "TRN-07", None, None),
    ("Recruitment Request", "Human Resources", "Talent Acquisition Lead", "careers@company.com", "5 business days", "HR Manager", "Head of HR", "SOP-09", "TRN-03", "Ritika Bose", "Meera Krishnan"),
    ("Marketing Support", "Marketing", "Marketing Operations Lead", "marketing@company.com", "5 business days", "Marketing Head", "COO", "SOP-16", "TRN-15", "Priya Nair", "Ananya Das"),
    ("Sales Support", "Sales", "Sales Operations Lead", "salesops@company.com", "3 business days", "Sales Head", "COO", "SOP-17", "TRN-15", "Priya Nair", "Ananya Das"),
]

# Mock common-mistake register. Replaced wholesale once the real survey is
# uploaded through /api/v1/admin/mistakes/replace-seed (Edge API).
MISTAKES = [
    ("MIS-001", "Using a personal email ID for official work", "Official correspondence sent from a personal email account.", "Use only the organisation-issued email account for all official communication.", "Communication", "high", "TRN-06"),
    ("MIS-002", "Sharing a personal mobile number as the official contact", "A personal number is given to vendors or clients instead of the official channel.", "Publish only the official contact number or helpdesk channel.", "Communication", "medium", "TRN-08"),
    ("MIS-003", "Using a personal laptop without approval", "Company data is processed on an unapproved personal device.", "Request an approved company asset before handling organisation data.", "Information Security", "critical", "TRN-12"),
    ("MIS-004", "Collecting assets outside the authorised process", "Assets are handed over informally with no record.", "Collect every asset through the documented allocation process and sign the record.", "Asset Management", "high", "TRN-12"),
    ("MIS-005", "Incorrect use of Reply All", "Recipients who need visibility are dropped, or everyone is copied unnecessarily.", "Use Reply All only when every recipient genuinely needs the update.", "Communication", "low", "TRN-08"),
    ("MIS-006", "Missing or outdated email signature", "Emails carry an old designation, old number or no signature at all.", "Keep the approved signature template current and remove superseded details.", "Communication", "low", "TRN-08"),
    ("MIS-007", "Ignoring file naming conventions", "Files are saved with ad-hoc names that cannot be found later.", "Apply the published naming convention to every document.", "Records", "medium", "TRN-20"),
    ("MIS-008", "Saving documents outside approved locations", "Work is stored on a desktop or personal drive.", "Save all work in the approved company location only.", "Records", "high", "TRN-20"),
    ("MIS-009", "Storing company data on personal devices", "Organisation data is copied to personal phones or drives.", "Keep all organisation data inside approved systems.", "Information Security", "critical", "TRN-06"),
    ("MIS-010", "Using informal channels for official requests", "Requests are made over personal chat instead of the official channel.", "Raise every request through the official channel so it is tracked.", "Process", "medium", "TRN-15"),
]


def seed_database(db: Session) -> None:
    if db.scalar(select(Organization.id).limit(1)):
        return
    org = Organization(name="Example Organisation", slug="example-organisation", settings={"passing_score": 80, "brand": "OneWork"})
    db.add(org); db.flush()
    departments = {}
    for code, name in [("HR", "Human Resources"), ("IT", "Information Technology"), ("FIN", "Finance"), ("OPS", "Operations"), ("ADM", "Administration")]:
        dep = Department(org_id=org.id, name=name, code=code); db.add(dep); db.flush(); departments[name] = dep
    employee = User(org_id=org.id, department_id=departments["Operations"].id, email="employee@company.com", full_name="Asha Sharma", role="employee", password_hash=hash_password("Demo123!"))
    admin = User(org_id=org.id, department_id=departments["Human Resources"].id, email="admin@company.com", full_name="Company Admin", role="admin", password_hash=hash_password("Admin123!"))
    manager = User(org_id=org.id, department_id=departments["Operations"].id, email="manager@company.com", full_name="Rohan Verma", role="manager", password_hash=hash_password("Manager123!"))
    db.add_all([employee, admin, manager]); db.flush()
    # BUILD PROMPT v5 item A3/A2: manager.manager_id = admin demonstrates
    # skip-level rollup; the extra employees below give the manager a
    # real, multi-department team (5 direct reports) instead of the one
    # person the department-proxy version happened to show.
    manager.manager_id = admin.id
    extra_employees = [
        User(org_id=org.id, department_id=departments["Information Technology"].id, email="karan.mehta@company.com", full_name="Karan Mehta", role="employee", password_hash=hash_password("Demo123!"), manager_id=manager.id),
        User(org_id=org.id, department_id=departments["Information Technology"].id, email="sneha.iyer@company.com", full_name="Sneha Iyer", role="employee", password_hash=hash_password("Demo123!"), manager_id=manager.id),
        User(org_id=org.id, department_id=departments["Finance"].id, email="vikram.rao@company.com", full_name="Vikram Rao", role="employee", password_hash=hash_password("Demo123!"), manager_id=manager.id),
        User(org_id=org.id, department_id=departments["Operations"].id, email="isha.kapoor@company.com", full_name="Isha Kapoor", role="employee", password_hash=hash_password("Demo123!"), manager_id=manager.id),
    ]
    employee.manager_id = manager.id
    db.add_all(extra_employees); db.flush()
    all_employees = [employee, *extra_employees]
    modules = []
    for index, (code, title, objective, duration) in enumerate(MODULES, 1):
        module = TrainingModule(org_id=org.id, code=code, title=title, objective=objective, duration_minutes=duration, sequence=index, content_type="mixed", content={"sections": [objective], "prototype": False})
        db.add(module); db.flush(); modules.append(module)
        db.add(QuizQuestion(org_id=org.id, module_id=module.id, prompt=f"Which action best demonstrates: {title}?", options=["Use the approved process and documented owner", "Ask informally and skip the record", "Use a personal channel", "Wait without escalating"], correct_index=0, explanation="Use the approved process, official channel and documented owner."))
        # Each team member gets a different, believable completion
        # profile instead of every seeded person being identical — real
        # variance is what makes the Manager Dashboard's per-member column
        # demonstrate anything.
        for member_index, member in enumerate(all_employees):
            threshold = 2 + member_index * 2  # completes progressively more of the curriculum
            in_progress_at = threshold + 1
            if index <= threshold:
                status, percent, completed_at = "completed", 100, datetime.utcnow() - timedelta(days=max(0, threshold - index))
            elif index == in_progress_at:
                status, percent, completed_at = "in_progress", 42, None
            else:
                status, percent, completed_at = "locked", 0, None
            # Two deliberately overdue rows (item A2: "notifications that
            # actually fire") — an in-progress module with a due_date in
            # the past, for the first two team members only. Both
            # _enqueue_reminders (here) and the Edge Function's SQL
            # equivalent key the "learning_reminder" trigger off
            # updated_at staleness (7+ days untouched), not due_date
            # directly — due_date only drives the Manager Dashboard's
            # overdue count — so updated_at is backdated too, or the
            # reminder would silently never fire against fresh seed rows.
            is_overdue_demo_row = member_index < 2 and index == in_progress_at
            due_date = date.today() - timedelta(days=3) if is_overdue_demo_row else None
            row_updated_at = datetime.utcnow() - timedelta(days=9) if is_overdue_demo_row else datetime.utcnow()
            db.add(Enrollment(org_id=org.id, user_id=member.id, module_id=module.id, status=status, progress_percent=percent, best_score=90 if index == 1 and status == "completed" else 85 if index == 2 and status == "completed" else None, completed_at=completed_at, due_date=due_date, updated_at=row_updated_at))
    db.add(Certificate(org_id=org.id, user_id=employee.id, module_id=modules[0].id, certificate_number="OW-WPB-2026-0001", issued_at=date.today() - timedelta(days=20), expires_at=date.today() + timedelta(days=345)))
    # Two certificates expiring within 7 days — the other half of "make
    # notifications actually fire" (the org's only other cert-bearing
    # module completions, on the two employees with the deepest curriculum
    # progress).
    db.add(Certificate(org_id=org.id, user_id=extra_employees[2].id, module_id=modules[0].id, certificate_number="OW-WPB-2026-0002", issued_at=date.today() - timedelta(days=357), expires_at=date.today() + timedelta(days=4)))
    db.add(Certificate(org_id=org.id, user_id=extra_employees[3].id, module_id=modules[1].id, certificate_number="OW-WPB-2026-0003", issued_at=date.today() - timedelta(days=360), expires_at=date.today() + timedelta(days=6)))
    for name, department, role, contact, sla, l1, l2, sop, module, current_person, backup_person in ACTIVITIES:
        db.add(Activity(org_id=org.id, name=name, department=department, responsible_role=role, current_person=current_person or "Organisation to confirm", backup_person=backup_person or f"{department} backup", contact_details=contact, sla=sla, escalation_level_1=l1, escalation_level_2=l2, related_documents=[f"{sop} form or checklist"], sop_link=sop, training_module_link=module, process_steps=["Open the official request channel", "Provide the required information and evidence", "Track the published SLA", f"Escalate to {l1} if unresolved"]))
    module_by_code = {m.code: m for m in modules}
    for code, title, description, correct_practice, category, severity, module_code in MISTAKES:
        db.add(MistakeRegisterEntry(org_id=org.id, code=code, title=title, description=description, correct_practice=correct_practice, category=category, severity=severity, module_id=module_by_code[module_code].id, is_seed=True))
    # BUILD PROMPT v5 item A2: 75 days of readiness history so the Exec
    # View trend chart shows a real line on first open, not 1-2 points.
    # A gentle upward trend with light day-to-day noise, not a perfectly
    # straight line — org readiness in reality doesn't move linearly.
    for days_ago in range(75, -1, -1):
        progress = (75 - days_ago) / 75
        noise = math.sin(days_ago * 0.6) * 3
        score = max(0, min(100, round(28 + progress * 40 + noise)))
        db.add(ReadinessSnapshot(org_id=org.id, score=score, components=[{"key": "training", "label": "Org-wide training completion", "percent": score}], captured_at=date.today() - timedelta(days=days_ago)))
    # BUILD PROMPT v5 BLOCK A: default preboarding content so the public
    # preview page has real copy on first load, matching the Supabase seed.
    for block_key, body in [
        ("welcome", "Welcome — we're glad you're considering joining us. This page gives you a clear picture of what to expect before you accept, so there are no surprises on day one."),
        ("expectations_from_you", "We expect punctuality, ownership of your responsibilities once assigned, and honest communication when something is blocking you. Full role-specific expectations are shared once your department is confirmed."),
        ("expectations_from_us", "You can expect a structured onboarding path, a named point of contact for every question, and transparency about how your role fits the wider organisation."),
    ]:
        db.add(OrgPreboardingContent(org_id=org.id, block_key=block_key, body=body))
    # BUILD PROMPT v5 BLOCK B: default 3-stage onboarding journey, matching
    # the Supabase seed exactly so both stacks demo identically.
    stage_1 = OnboardingStage(org_id=org.id, name="Getting started", description="The basics before anything else.", sequence=1)
    stage_2 = OnboardingStage(org_id=org.id, name="Learn the ropes", description="Complete your first assigned training.", sequence=2)
    stage_3 = OnboardingStage(org_id=org.id, name="You're set", description="Final housekeeping before you're fully onboarded.", sequence=3)
    db.add_all([stage_1, stage_2, stage_3]); db.flush()
    db.add(OnboardingStageItem(stage_id=stage_1.id, item_type="custom_task", title="Set up your workstation", description="Confirm your laptop, email and access badges are ready.", sequence=1))
    db.add(OnboardingStageItem(stage_id=stage_2.id, item_type="training_module", training_module_id=modules[0].id, title=modules[0].title, description="Complete this to move on to the next stage.", sequence=1))
    db.add(OnboardingStageItem(stage_id=stage_3.id, item_type="custom_task", title="Meet your manager", description="Have a short introductory call with your manager.", sequence=1))
    db.commit()
