from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Activity, Certificate, Department, Enrollment, Organization, QuizQuestion, SOPDocument, TrainingModule, User
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

ACTIVITIES = [
    ("Applying for Leave", "Human Resources", "HR Executive", "hr-helpdesk@company.com", "2 business days", "HR Manager", "Head of HR", "SOP-01", "TRN-10"),
    ("Attendance Regularisation", "Human Resources", "HR Executive", "hr-helpdesk@company.com", "2 business days", "HR Manager", "Head of HR", "SOP-01", "TRN-10"),
    ("Payroll Query", "Human Resources", "Payroll Specialist", "payroll@company.com", "3 business days", "HR Manager", "Head of HR", "SOP-06", "TRN-09"),
    ("Employee Referral", "Human Resources", "Talent Acquisition Lead", "careers@company.com", "5 business days", "HR Manager", "Head of HR", "SOP-09", "TRN-03"),
    ("Exit Process & Asset Return", "Human Resources", "HR Operations Lead", "hr-helpdesk@company.com", "As per notice", "HR Manager", "Head of HR", "SOP-05", "TRN-12"),
    ("Laptop / Asset Request", "Information Technology", "IT Asset Coordinator", "it-support@company.com", "3 business days", "IT Manager", "Head of IT", "SOP-02", "TRN-12"),
    ("Damaged Equipment", "Information Technology", "IT Service Desk", "it-support@company.com", "4 business hours", "IT Manager", "Head of IT", "SOP-03", "TRN-13"),
    ("IT Support Ticket", "Information Technology", "IT Support Engineer", "it-support@company.com", "1 business day", "IT Manager", "Head of IT", "SOP-03", "TRN-13"),
    ("New Software Access", "Information Technology", "IT Administrator", "it-support@company.com", "2 business days", "IT Manager", "Head of IT", "SOP-04", "TRN-13"),
    ("Password / Email Issue", "Information Technology", "IT Service Desk", "it-support@company.com", "4 business hours", "IT Manager", "Head of IT", "SOP-03", "TRN-06"),
    ("Expense Reimbursement", "Finance", "Accounts Payable Specialist", "expenses@company.com", "Next pay cycle", "Finance Manager", "CFO", "SOP-10", "TRN-11"),
    ("Finance Approval", "Finance", "Finance Business Partner", "finance@company.com", "3 business days", "Finance Manager", "CFO", "SOP-07", "TRN-11"),
    ("Purchase Request", "Procurement", "Procurement Executive", "procurement@company.com", "5 business days", "Procurement Manager", "COO", "SOP-07", "TRN-14"),
    ("Vendor Onboarding", "Procurement", "Vendor Management Lead", "vendors@company.com", "10 business days", "Procurement Manager", "COO", "SOP-08", "TRN-14"),
    ("Travel Approval", "Administration", "Travel Coordinator", "travel@company.com", "3 business days", "Admin Manager", "COO", "SOP-11", "TRN-09"),
    ("Meeting Room Booking", "Administration", "Facilities Coordinator", "facilities@company.com", "Same day", "Admin Manager", "COO", "SOP-12", "TRN-21"),
    ("Visitor Management", "Administration", "Front Office Executive", "reception@company.com", "1 business day", "Admin Manager", "COO", "SOP-13", "TRN-09"),
    ("ID / Visiting Card Request", "Administration", "Admin Executive", "admin@company.com", "5 business days", "Admin Manager", "COO", "SOP-14", "TRN-09"),
    ("Contract / Legal Approval", "Legal & Compliance", "Legal Counsel", "legal@company.com", "7 business days", "Legal Manager", "General Counsel", "SOP-15", "TRN-07"),
    ("Recruitment Request", "Human Resources", "Talent Acquisition Lead", "careers@company.com", "5 business days", "HR Manager", "Head of HR", "SOP-09", "TRN-03"),
    ("Marketing Support", "Marketing", "Marketing Operations Lead", "marketing@company.com", "5 business days", "Marketing Head", "COO", "SOP-16", "TRN-15"),
    ("Sales Support", "Sales", "Sales Operations Lead", "salesops@company.com", "3 business days", "Sales Head", "COO", "SOP-17", "TRN-15"),
]

SOPS = [
    ("SOP-01", "Leave & Attendance", "Human Resources"), ("SOP-02", "Asset Request, Allocation & Return", "Information Technology"),
    ("SOP-03", "IT Support & Incident Triage", "Information Technology"), ("SOP-04", "Software Access & Permissions", "Information Technology"),
    ("SOP-05", "Employee Exit & Handover", "Human Resources"), ("SOP-06", "Payroll Query Resolution", "Human Resources"),
    ("SOP-07", "Purchase & Finance Approval", "Finance / Procurement"), ("SOP-08", "Vendor Onboarding & Changes", "Procurement"),
    ("SOP-09", "Recruitment & Referral", "Human Resources"), ("SOP-10", "Expense Reimbursement", "Finance"),
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
    db.add_all([employee, admin]); db.flush()
    modules = []
    for index, (code, title, objective, duration) in enumerate(MODULES, 1):
        module = TrainingModule(org_id=org.id, code=code, title=title, objective=objective, duration_minutes=duration, sequence=index, content_type="mixed", content={"sections": [objective], "prototype": False})
        db.add(module); db.flush(); modules.append(module)
        db.add(QuizQuestion(org_id=org.id, module_id=module.id, prompt=f"Which action best demonstrates: {title}?", options=["Use the approved process and documented owner", "Ask informally and skip the record", "Use a personal channel", "Wait without escalating"], correct_index=0, explanation="Use the approved process, official channel and documented owner."))
        db.add(Enrollment(org_id=org.id, user_id=employee.id, module_id=module.id, status="completed" if index <= 2 else "in_progress" if index == 3 else "locked", progress_percent=100 if index <= 2 else 42 if index == 3 else 0, best_score=90 if index == 1 else 85 if index == 2 else None))
    db.add(Certificate(org_id=org.id, user_id=employee.id, module_id=modules[0].id, certificate_number="OW-WPB-2026-0001", issued_at=date.today() - timedelta(days=20), expires_at=date.today() + timedelta(days=345)))
    for name, department, role, contact, sla, l1, l2, sop, module in ACTIVITIES:
        db.add(Activity(org_id=org.id, name=name, department=department, responsible_role=role, current_person="Organisation to confirm", backup_person=f"{department} backup", contact_details=contact, sla=sla, escalation_level_1=l1, escalation_level_2=l2, related_documents=[f"{sop} form or checklist"], sop_link=sop, training_module_link=module, process_steps=["Open the official request channel", "Provide the required information and evidence", "Track the published SLA", f"Escalate to {l1} if unresolved"]))
    for code, title, department in SOPS:
        db.add(SOPDocument(org_id=org.id, code=code, title=title, department=department, owner_role=f"{department} process owner", approver_role=f"{department} head", version="1.0", status="effective", effective_date=date.today(), review_date=date.today() + timedelta(days=180), summary=f"Controlled procedure for {title.lower()}.", content={"purpose": f"Standardise {title.lower()}", "scope": "All employees", "steps": ["Use the official channel", "Complete required fields", "Retain evidence", "Escalate within the published hierarchy"], "controls": ["Owner approval", "Version control", "Audit trail"]}))
    db.commit()
