from datetime import date
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from .auth import hash_password
from .database import Base, SessionLocal, engine
from .models import (AssignmentStatus, CycleStatus, Department, Designation, Division,
                     KpiAssignment, KpiCycle, KpiItem, KpiResponse, KpiTemplate, Kra,
                     Role, SystemSetting, TemplateStatus, User)
from .services import recalc_assignment

Base.metadata.create_all(bind=engine)


def add_structure(db):
    def div(name):
        obj = db.scalar(select(Division).where(Division.name == name))
        if not obj:
            obj = Division(name=name); db.add(obj); db.flush()
        return obj
    def dep(name, d):
        obj = db.scalar(select(Department).where(Department.name == name, Department.division_id == d.id))
        if not obj:
            obj = Department(name=name, division_id=d.id); db.add(obj); db.flush()
        return obj
    def des(name, p):
        obj = db.scalar(select(Designation).where(Designation.name == name, Designation.department_id == p.id))
        if not obj:
            obj = Designation(name=name, department_id=p.id); db.add(obj); db.flush()
        return obj

    ops = div("Operations & Projects")
    fin = div("Finance & Commercial")
    tech = div("Technical / Software Development")
    sales = div("Sales / Pre-Sales")
    hra = div("HR & Administration")
    structures = {
        "project_manager": des("Project Manager", dep("Project Management", ops)),
        "project_executive": des("Project Executive", dep("Project Management", ops)),
        "finance_manager": des("Finance Manager", dep("Finance", fin)),
        "accounts_executive": des("Accounts Executive", dep("Finance", fin)),
        "avp_technical": des("AVP – Technical & Pre-Sales", dep("Technical & Pre-Sales", tech)),
        "software_developer": des("Software Developer", dep("Software Development", tech)),
        "sales_manager": des("Sales Manager", dep("Sales", sales)),
        "sales_executive": des("Sales Executive", dep("Sales", sales)),
        "hr_manager": des("HR Manager", dep("HR", hra)),
        "admin_manager": des("Admin Executive/Manager", dep("Administration", hra)),
        "svp_projects": des("SVP – Projects", dep("Project Management", ops)),
        "avp_technology": des("AVP – Technology / Java Full Stack & Government Projects", dep("Software Development", tech)),
        "java_project_manager": des("Project Manager – Java Full Stack / Government Projects", dep("Software Development", tech)),
        "team_lead_java": des("Team Lead – Java Full Stack", dep("Software Development", tech)),
        "business_analyst_testing_lead": des("Business Analyst & Testing Lead", dep("Quality & Business Analysis", tech)),
    }
    db.commit()
    return structures


def item(question, input_type, weight, target=None, direction="higher", options=None):
    return {"question": question, "input_type": input_type, "weight": weight, "target_value": target, "direction": direction, "options": options}


def choice(question, weight):
    return item(question, "choice", weight, options={"Excellent": 100, "Good": 80, "Average": 60, "Poor": 40, "Not achieved": 0})


def yesno(question, weight):
    return item(question, "yesno", weight, options={"Yes": 100, "No": 0})


def source_options(source, frequency="Monthly", measurement="", weight_basis="Source-defined", evidence=False, score_map=None):
    return {
        "score_map": score_map or {},
        "meta": {
            "source": source,
            "frequency": frequency,
            "measurement": measurement,
            "weight_basis": weight_basis,
            "evidence_required": evidence,
            "scoring_method": "target_ratio",
            "score_cap_pct": 100,
        },
    }


def source_choice(question, weight, source, frequency="Monthly", measurement="", weight_basis="Source-defined", evidence=False):
    mapping = {"Excellent": 100, "Good": 80, "Average": 60, "Poor": 40, "Not achieved": 0}
    return item(question, "choice", weight, options=source_options(source, frequency, measurement, weight_basis, evidence, mapping))


def source_numeric(question, input_type, weight, target, source, frequency="Monthly", direction="higher", measurement="", weight_basis="Source-defined", evidence=False):
    return item(question, input_type, weight, target, direction, source_options(source, frequency, measurement, weight_basis, evidence))


def create_template(db, name, designation_id, kras):
    existing = db.scalar(select(KpiTemplate).where(KpiTemplate.name == name))
    if existing:
        return existing
    t = KpiTemplate(name=name, designation_id=designation_id, status=TemplateStatus.active, version=1)
    db.add(t); db.flush()
    for kra_name, kra_weight, items in kras:
        k = Kra(template_id=t.id, name=kra_name, weight=kra_weight); db.add(k); db.flush()
        for data in items:
            db.add(KpiItem(kra_id=k.id, **data))
    db.commit()
    return t


def add_templates(db, s):
    technical = create_template(db, "AVP Technical & Pre-Sales", s["avp_technical"].id, [
        ("SLA Compliance", 30, [item("SLA compliance percentage", "percentage", 20, 95), item("Daily Activity Report compliance", "percentage", 10, 100)]),
        ("Technical Operations & Monitoring", 20, [item("Assigned location coverage", "percentage", 5, 100), yesno("Monthly technical audit completed with corrective actions", 5), item("Infrastructure availability", "percentage", 5, 99), yesno("Zero critical operational disruptions", 5)]),
        ("Pre-Sales & Tender Support", 20, [item("Error-free RFP / BOQ verification", "percentage", 8, 100), choice("Timely pre-sales support for assigned opportunities", 6), choice("Solution designs approved within proposal timeline", 6)]),
        ("Data Centre & Infrastructure Management", 10, [item("Data centre / server availability", "percentage", 7, 99), choice("Backups, server health and preventive maintenance", 3)]),
        ("Inventory & Asset Management", 10, [item("Inventory accuracy", "percentage", 10, 100)]),
        ("Reporting & Documentation", 10, [item("Weekly/monthly reports submitted on time", "percentage", 10, 100)]),
    ])
    finance = create_template(db, "Finance Manager", s["finance_manager"].id, [
        ("Billing & Collection", 25, [item("Invoices raised on time", "percentage", 8, 100), item("Billing accuracy", "percentage", 7, 100), item("Payments collected within agreed terms", "percentage", 10, 100)]),
        ("Project Financial Control", 20, [item("Projects completed within approved cost", "percentage", 8, 100), item("Budget deviation", "percentage", 6, 5, "lower"), choice("Finance approvals supported project timelines", 6)]),
        ("Payment & Commercial Management", 15, [item("Payment approval TAT (days)", "days", 5, 2, "lower"), item("Savings through OEM/vendor negotiation", "percentage", 5, 5), choice("Commercial terms negotiated favorably", 5)]),
        ("Cash Flow Management", 15, [item("Project-wise cash flow forecast accuracy", "percentage", 8, 95), choice("Cash shortages proactively prevented", 7)]),
        ("Tender / Procurement Costing", 15, [item("Bid costing accuracy", "percentage", 5, 95), item("EMDs submitted on time", "percentage", 5, 100), choice("Procurement budget and vendor selection supported effectively", 5)]),
        ("MIS & Coordination", 10, [item("Monthly / quarterly MIS submitted on time", "percentage", 5, 100), item("Financial report accuracy", "percentage", 3, 100), choice("Coordination with technical team without rework", 2)]),
    ])
    project = create_template(db, "Project Manager", s["project_manager"].id, [
        ("Project Planning & Delivery", 20, [item("Milestones completed on schedule", "percentage", 10, 100), item("Deliverables completed within timeline", "percentage", 10, 100)]),
        ("Quality & Contract Compliance", 15, [choice("Project quality standards met", 8), choice("Contract / scope / statutory compliance", 7)]),
        ("Budget & Cost Control", 15, [item("Projects within approved budget", "percentage", 10, 100), choice("Cost overruns controlled and explained", 5)]),
        ("Team & Vendor Management", 15, [choice("Team resources allocated and supervised efficiently", 8), choice("Vendor / contractor performance managed", 7)]),
        ("Risk, Safety & Change", 10, [choice("Project risks identified and mitigated", 4), yesno("Safety / government guideline compliance maintained", 3), choice("Scope changes handled within approval timelines", 3)]),
        ("Client & Stakeholder Coordination", 10, [choice("Government/client issues resolved on time", 5), choice("Stakeholders coordinated effectively", 5)]),
        ("Documentation & Closure", 15, [item("Progress reports/invoices/documents submitted on time", "percentage", 8, 100), choice("Project handover and closure completed correctly", 7)]),
    ])
    hr = create_template(db, "HR Manager", s["hr_manager"].id, [
        ("Recruitment & Onboarding", 20, [item("Positions filled within approved timeline", "percentage", 10, 100), item("Onboarding documentation completed", "percentage", 10, 100)]),
        ("HR Operations & Payroll", 20, [item("Employee records and HR letters completed on time", "percentage", 8, 100), item("Attendance / leave / payroll accuracy", "percentage", 12, 100)]),
        ("Compliance & Policy", 15, [item("Statutory filings completed on time", "percentage", 8, 100), choice("HR policies implemented and improved", 7)]),
        ("Performance Management", 15, [item("Probation/appraisal reviews completed on schedule", "percentage", 15, 100)]),
        ("Employee Relations & Development", 15, [choice("Employee grievances resolved promptly", 8), choice("Training needs identified and learning coordinated", 7)]),
        ("HR Reporting", 15, [item("Monthly HR MIS/manpower reports submitted on time", "percentage", 15, 100)]),
    ])
    admin = create_template(db, "Admin Executive / Manager", s["admin_manager"].id, [
        ("Facility, Housekeeping & Security", 20, [choice("Office cleanliness, maintenance and infrastructure upkeep", 10), choice("Housekeeping and security operations", 10)]),
        ("Vendor & Procurement", 15, [choice("Vendor selection, coordination and service delivery", 8), item("Procurement requests completed on time", "percentage", 7, 100)]),
        ("Assets, Transport & Utilities", 20, [item("Asset record accuracy", "percentage", 7, 100), choice("Vehicle allocation / maintenance / driver coordination", 6), item("Utilities paid/monitored on time", "percentage", 7, 100)]),
        ("Office Administration & Support", 15, [choice("Daily administration completed efficiently", 8), item("Employee administration requests resolved on time", "percentage", 7, 100)]),
        ("Compliance & Documentation", 15, [item("Licenses/statutory/admin documents renewed on time", "percentage", 15, 100)]),
        ("Budget, Events & Meetings", 15, [choice("Administrative expenses controlled within budget", 8), choice("Meetings/events/visitor management arranged successfully", 7)]),
    ])
    sales = create_template(db, "Sales Manager", s["sales_manager"].id, [
        ("Revenue Target", 30, [item("Monthly sales target achievement", "percentage", 20, 100), item("Gross margin target achievement", "percentage", 10, 100)]),
        ("Pipeline & Conversion", 20, [item("Qualified pipeline coverage", "percentage", 10, 100), item("Opportunity conversion target", "percentage", 10, 100)]),
        ("New Business", 15, [item("New customer acquisition target", "percentage", 15, 100)]),
        ("Collection Support", 15, [item("Sales-linked collection target", "percentage", 15, 100)]),
        ("Customer & Proposal Management", 10, [choice("Customer follow-ups, proposals and coordination completed on time", 10)]),
        ("Reporting", 10, [item("Sales MIS / forecast reporting submitted on time", "percentage", 10, 100)]),
    ])
    project_exec = create_template(db, "Project Executive", s["project_executive"].id, [
        ("Task & Milestone Delivery", 35, [item("Assigned tasks completed within timeline", "percentage", 20, 100), item("Milestones / deliverables completed", "percentage", 15, 100)]),
        ("Quality & Rework", 20, [item("Work accepted without rework", "percentage", 12, 100), choice("Quality and specification compliance", 8)]),
        ("Coordination", 15, [choice("Client / manager coordination completed on time", 8), choice("Vendor / team dependencies followed up", 7)]),
        ("Documentation", 15, [item("Daily / weekly / project updates submitted on time", "percentage", 15, 100)]),
        ("Compliance & Discipline", 15, [choice("Process, safety and attendance discipline", 15)]),
    ])
    accounts_exec = create_template(db, "Accounts Executive", s["accounts_executive"].id, [
        ("Billing", 30, [item("Invoices raised on time", "percentage", 15, 100), item("Billing accuracy", "percentage", 15, 100)]),
        ("Collection Follow-up", 30, [item("Collection follow-ups completed on time", "percentage", 15, 100), item("Payments collected within agreed terms", "percentage", 15, 100)]),
        ("Payment Processing", 15, [item("Payment processing TAT (days)", "days", 10, 2, "lower"), choice("Payment records maintained accurately", 5)]),
        ("Reconciliation & Documentation", 15, [item("Reconciliations / records completed on time", "percentage", 10, 100), choice("Supporting documents complete", 5)]),
        ("MIS & Coordination", 10, [item("Monthly MIS inputs submitted on time", "percentage", 5, 100), choice("Internal coordination completed without rework", 5)]),
    ])
    developer = create_template(db, "Software Developer", s["software_developer"].id, [
        ("Delivery", 35, [item("Assigned development tasks completed on time", "percentage", 20, 100), item("Sprint / milestone commitment achieved", "percentage", 15, 100)]),
        ("Quality", 25, [item("Work accepted without rework", "percentage", 12, 100), choice("Code quality / review feedback", 8), choice("Defects resolved within agreed time", 5)]),
        ("Reliability & Support", 15, [choice("Production / support issues handled within SLA", 8), choice("System stability and preventive fixes", 7)]),
        ("Documentation & Reporting", 10, [item("Technical updates / documentation submitted on time", "percentage", 10, 100)]),
        ("Collaboration & Improvement", 15, [choice("Team collaboration and knowledge sharing", 8), choice("Automation / process improvement contribution", 7)]),
    ])
    sales_exec = create_template(db, "Sales Executive", s["sales_executive"].id, [
        ("Sales Target", 35, [item("Monthly sales target achievement", "percentage", 25, 100), item("Margin target achievement", "percentage", 10, 100)]),
        ("Pipeline & Conversion", 25, [item("Qualified pipeline target achieved", "percentage", 12, 100), item("Opportunity conversion target achieved", "percentage", 13, 100)]),
        ("New Customer Development", 15, [item("New customer target achievement", "percentage", 15, 100)]),
        ("Collection & Follow-up", 15, [item("Sales-linked collection target achievement", "percentage", 10, 100), choice("Customer follow-ups completed on time", 5)]),
        ("Reporting", 10, [item("CRM / sales MIS updated on time", "percentage", 10, 100)]),
    ])

    svp_projects = create_template(db, "SVP Projects – Government Projects", s["svp_projects"].id, [
        ("Government Project Management", 15, [source_choice("Overall execution and performance of all assigned Government projects", 15, "SVP KPI.pdf", "Monthly", "Overall project execution and performance", "Recommended system weight – source has no weightage", True)]),
        ("SLA Adherence", 15, [source_numeric("Maintain contractual SLA / uptime / response and resolution timelines", "percentage", 15, 100, "SVP KPI.pdf", "Monthly", "higher", "100% SLA compliance or contractual requirement; zero critical breaches", "Recommended system weight – source has no weightage", True)]),
        ("Billing & Invoicing", 15, [source_numeric("Invoices submitted within contractual timelines", "percentage", 15, 100, "SVP KPI.pdf", "Monthly", "higher", "100% invoices on time with complete/accurate documentation", "Recommended system weight – source has no weightage", True)]),
        ("Collections / Receivables", 15, [source_numeric("Collection against due invoices within agreed payment period", "percentage", 15, 95, "SVP KPI.pdf", "Monthly", "higher", "≥95% collection; weekly outstanding monitoring and ageing report", "Recommended system weight – source has no weightage", True)]),
        ("Penalty / LD Control", 10, [source_numeric("Penalty / Liquidated Damages incidents", "count", 10, 0, "SVP KPI.pdf", "Monthly", "lower", "Target NIL penalty/LD and proactive risk correction", "Recommended system weight – source has no weightage", True)]),
        ("Client / Government Coordination", 10, [source_choice("Government/client review meetings, issue resolution and escalation management", 10, "SVP KPI.pdf", "Monthly", "Regular review meetings and timely escalation resolution", "Recommended system weight – source has no weightage", True)]),
        ("Project Profitability & Cost Control", 10, [source_choice("Monitor project costs, manpower, vendor expenses and overall profitability", 10, "SVP KPI.pdf", "Monthly", "Cost and profitability control", "Recommended system weight – source has no weightage", True)]),
        ("Compliance & Documentation", 5, [source_choice("Contract compliance, MIS, SLA reports, audit documents and statutory/project records", 5, "SVP KPI.pdf", "Monthly", "Compliance and audit readiness", "Recommended system weight – source has no weightage", True)]),
        ("Team Performance", 5, [source_choice("Leadership, manpower utilization, accountability and performance monitoring", 5, "SVP KPI.pdf", "Monthly", "Team performance", "Recommended system weight – source has no weightage")]),
    ])

    avp_java = create_template(db, "AVP Technology – Java Full Stack & Government Projects", s["avp_technology"].id, [
        ("Government Project Delivery", 20, [source_numeric("Milestone completion within agreed timelines", "percentage", 20, 95, "Software team.pdf", "Monthly", "higher", "≥95% milestone completion", "Source-defined weightage", True)]),
        ("Technology & Architecture", 15, [source_choice("Java architecture, Spring Boot, Microservices, APIs, database and cloud architecture", 15, "Software team.pdf", "Monthly", "Technology and architecture quality", "Source-defined weightage", True)]),
        ("Project Quality", 15, [source_numeric("Security and code-quality reviews for critical releases", "percentage", 8, 100, "Software team.pdf", "Per release", "higher", "100% security and code-quality reviews", "Source-defined weightage", True), source_choice("Production defects, vulnerabilities, performance and overall code quality", 7, "Software team.pdf", "Monthly", "Minimize defects and critical production issues", "Source-defined weightage", True)]),
        ("Government Client Management", 10, [source_choice("Coordination with Government departments, PMU/client and stakeholders", 10, "Software team.pdf", "Monthly", "Client coordination and escalation control", "Source-defined weightage", True)]),
        ("Team Management", 10, [source_choice("Productivity, resource allocation, performance and skill development", 10, "Software team.pdf", "Monthly", "Effective utilization of development resources", "Source-defined weightage")]),
        ("Compliance & Documentation", 10, [source_numeric("Government project documentation compliance", "percentage", 10, 100, "Software team.pdf", "Monthly", "higher", "SRS, HLD/LLD, APIs, test reports, UAT and project records", "Source-defined weightage", True)]),
        ("Presales & RFP Support", 10, [source_choice("RFP/RFQ analysis, technical proposals, estimation and solution design", 10, "Software team.pdf", "As required", "Timely RFP / technical proposal support", "Source-defined weightage", True)]),
        ("Innovation & Automation", 10, [source_choice("Automation, reusable components, AI/tools and process improvement", 10, "Software team.pdf", "Monthly", "Innovation and process improvement", "Source-defined weightage")]),
    ])

    java_pm = create_template(db, "Project Manager – Java Full Stack / Government Projects", s["java_project_manager"].id, [
        ("Project Planning & Execution", 20, [source_numeric("Sprint, milestone and overall project achievement", "percentage", 20, 95, "Software team.pdf", "Monthly", "higher", "≥95% milestone/sprint achievement", "Source-defined weightage", True)]),
        ("Government SLA Management", 15, [source_choice("SLA adherence, response time and issue resolution", 15, "Software team.pdf", "Monthly", "SLA adherence and issue resolution", "Source-defined weightage", True)]),
        ("Client Coordination", 15, [source_choice("Government/client meetings, communication and escalation management", 15, "Software team.pdf", "Monthly", "Minimize client complaints/escalations", "Source-defined weightage", True)]),
        ("Resource Management", 10, [source_choice("Developer allocation, utilization and workload management", 10, "Software team.pdf", "Monthly", "Resource allocation and utilization", "Source-defined weightage")]),
        ("Risk & Issue Management", 10, [source_choice("Identification, tracking and closure of project risks", 10, "Software team.pdf", "Monthly", "Risks and escalations reported proactively", "Source-defined weightage", True)]),
        ("Quality & Release Management", 10, [source_choice("UAT, defect closure, deployment and release management", 10, "Software team.pdf", "Per release", "Complete UAT and release documentation", "Source-defined weightage", True)]),
        ("Documentation & Compliance", 10, [source_numeric("Weekly/monthly project reporting and Government deliverables on time", "percentage", 10, 100, "Software team.pdf", "Weekly / Monthly", "higher", "100% project reporting and client deliverables submitted on time", "Source-defined weightage", True)]),
        ("Team Coordination", 10, [source_choice("Coordination between Java, UI, QA, DevOps, DBA and support teams", 10, "Software team.pdf", "Ongoing", "Cross-team coordination", "Source-defined weightage")]),
    ])

    java_tl = create_template(db, "Team Lead – Java Full Stack", s["team_lead_java"].id, [
        ("Java Development", 20, [source_choice("Java/Spring Boot development and task completion", 20, "Software team.pdf", "Sprint / Monthly", "Development delivery", "Source-defined weightage", True)]),
        ("Full Stack Development", 15, [source_choice("Frontend, backend, API and database integration", 15, "Software team.pdf", "Sprint / Monthly", "Full-stack integration", "Source-defined weightage", True)]),
        ("Code Quality", 15, [source_choice("Code review, coding standards, unit testing and defect prevention", 15, "Software team.pdf", "Per release", "Code quality", "Source-defined weightage", True)]),
        ("Technical Leadership", 15, [source_choice("Technical design, troubleshooting and mentoring", 15, "Software team.pdf", "Monthly", "Technical leadership", "Source-defined weightage")]),
        ("Sprint Delivery", 10, [source_choice("Completion of assigned tasks within sprint timelines", 10, "Software team.pdf", "Sprint", "Sprint delivery", "Source-defined weightage", True)]),
        ("Production Support", 10, [source_choice("Bug fixing and SLA-based issue resolution", 10, "Software team.pdf", "Ongoing", "Production support", "Source-defined weightage", True)]),
        ("Documentation & KT", 5, [source_choice("Technical documentation, KT and knowledge sharing", 5, "Software team.pdf", "Monthly", "Documentation and KT", "Source-defined weightage")]),
        ("Process Compliance", 5, [source_choice("Git, CI/CD, Agile, SDLC and security compliance", 5, "Software team.pdf", "Ongoing", "Process compliance", "Source-defined weightage", True)]),
        ("Innovation", 5, [source_choice("Automation, reusable components and process improvements", 5, "Software team.pdf", "Monthly", "Innovation", "Source-defined weightage")]),
    ])

    ba_testing = create_template(db, "Business Analyst & Testing Lead", s["business_analyst_testing_lead"].id, [
        ("Client Requirement Gathering", 8, [source_choice("Attend client meetings and collect complete requirements with minimum gaps/rework", 8, "Business Analyst & Testing Lead.pdf", "Every Project / Ongoing", "Requirement completeness", "Recommended system weight – source has no weightage", True)]),
        ("Requirement Analysis & Mapping", 7, [source_choice("Accurate mapping of new requirements to existing modules with proper documentation", 7, "Business Analyst & Testing Lead.pdf", "Per Requirement", "Requirement mapping accuracy", "Recommended system weight – source has no weightage", True)]),
        ("Mock-up Preparation", 5, [source_choice("Timely preparation of functional mock-ups/wireframes for customer approval", 5, "Business Analyst & Testing Lead.pdf", "As Required", "Mock-up timeliness", "Recommended system weight – source has no weightage", True)]),
        ("Requirement Documentation", 10, [source_numeric("BRD/FRD, requirement notes and scope documentation compliance", "percentage", 10, 100, "Business Analyst & Testing Lead.pdf", "Per Project", "higher", "100% documentation compliance", "Recommended system weight – source has no weightage", True)]),
        ("Test Case Preparation", 8, [source_choice("Comprehensive test cases covering all scenarios", 8, "Business Analyst & Testing Lead.pdf", "Per Module / Release", "Test case coverage", "Recommended system weight – source has no weightage", True)]),
        ("Automation & Load Testing", 5, [source_choice("Prepare test scripts wherever automation/load testing is required", 5, "Business Analyst & Testing Lead.pdf", "Based on Project Requirement", "Automation/load testing readiness", "Recommended system weight – source has no weightage", True)]),
        ("Knowledge Transfer (KT)", 4, [source_choice("Receive and understand KT from PMs/Developers before testing released features", 4, "Business Analyst & Testing Lead.pdf", "Every Release", "KT readiness", "Recommended system weight – source has no weightage")]),
        ("Functional & Scenario Testing", 10, [source_numeric("Functional, regression, integration and load testing completion before release", "percentage", 10, 100, "Business Analyst & Testing Lead.pdf", "Per Release", "higher", "100% test completion before release", "Recommended system weight – source has no weightage", True)]),
        ("Bug Identification & Reporting", 10, [source_choice("Timely reporting/tracking of defects with closure validation", 10, "Business Analyst & Testing Lead.pdf", "Based on Release Cycle", "Defect reporting and closure", "Recommended system weight – source has no weightage", True)]),
        ("QC Documentation & Status Tracking", 5, [source_choice("Maintain QC stages, test reports and completion status", 5, "Business Analyst & Testing Lead.pdf", "Weekly / Monthly", "QC documentation", "Recommended system weight – source has no weightage", True)]),
        ("Client Demo & Delivery Mapping", 5, [source_choice("Conduct client demos and clearly explain scope and deliverables", 5, "Business Analyst & Testing Lead.pdf", "Per Project Milestone", "Demo and delivery mapping", "Recommended system weight – source has no weightage")]),
        ("Scope Creep Identification", 5, [source_choice("Identify additional requirements/change requests and report to PMs", 5, "Business Analyst & Testing Lead.pdf", "Continuous", "Scope creep identification", "Recommended system weight – source has no weightage", True)]),
        ("Customer & Developer Coordination", 5, [source_choice("Coordinate with developers, project teams and customers for issue resolution", 5, "Business Analyst & Testing Lead.pdf", "Ongoing", "Coordination effectiveness", "Recommended system weight – source has no weightage")]),
        ("QA Team Supervision", 5, [source_choice("Monitor day-to-day QA activities and ensure timely task completion", 5, "Business Analyst & Testing Lead.pdf", "Daily / Weekly", "QA team supervision", "Recommended system weight – source has no weightage")]),
        ("Management Reporting", 8, [source_choice("Periodic status reports on testing progress, issues and project updates", 8, "Business Analyst & Testing Lead.pdf", "Weekly / Monthly", "Management reporting", "Recommended system weight – source has no weightage", True)]),
    ])

    sales_source = create_template(db, "Sales – Tender, Business Development & Collections", s["sales_manager"].id, [
        ("Revenue & Conversions", 25, [source_choice(q, 25/6, "Sales KRA KPI(New) (1).csv", "Not specified in source", "", "Recommended system weight – source has no weightage/targets") for q in ["Tender Conversion Performance", "Revenue Generation", "Funnel Conversion", "Efficiency Payment", "Conversion Quality Indicators", "Sales Cycle Efficiency"]]),
        ("Tender Management", 20, [source_choice(q, 20/6, "Sales KRA KPI(New) (1).csv", "Not specified in source", "", "Recommended system weight – source has no weightage/targets", True) for q in ["Tender Identification & Qualification", "Bid Submission Efficiency", "Documentation & Compliance", "Bid Quality & Competitiveness", "Coordination & Internal Alignment", "Post-Bid Follow-up"]]),
        ("Business Development", 15, [source_choice(q, 15/6, "Sales KRA KPI(New) (1).csv", "Not specified in source", "", "Recommended system weight – source has no weightage/targets") for q in ["Lead Generation & Opportunity Creation", "Client Engagement & Meetings", "New Business Acquisition", "Relationship Building", "Opportunity Conversion to Tender Stage", "Strategic Expansion"]]),
        ("Client Management", 10, [source_choice(q, 2.5, "Sales KRA KPI(New) (1).csv", "Not specified in source", "", "Recommended system weight – source has no weightage/targets") for q in ["Client Relationship Health", "Client Retention", "Payment & Commercial Management", "Client Engagement & Growth"]]),
        ("Collections", 15, [source_choice(q, 2.5, "Sales KRA KPI(New) (1).csv", "Not specified in source", "", "Recommended system weight – source has no weightage/targets", True) for q in ["Collection Efficiency", "Aging & Outstanding Control", "Payment Cycle Management", "Follow-up Effectiveness", "Dispute & Escalation Handling", "Client-wise Collection Performance"]]),
        ("Compliance & Reporting", 10, [source_choice(q, 2, "Sales KRA KPI(New) (1).csv", "Not specified in source", "", "Recommended system weight – source has no weightage/targets", True) for q in ["Reporting Discipline", "Documentation Compliance", "Regulatory & Tender Compliance", "Data Quality & Visibility", "Internal Coordination & Governance"]]),
        ("Market Intelligence & Strategy", 5, [source_choice(q, 1.25, "Sales KRA KPI(New) (1).csv", "Not specified in source", "", "Recommended system weight – source has no weightage/targets") for q in ["Market opportunity", "Competitor intelligence", "Customer & stakeholder insights", "Strategic Planning & Reporting"]]),
    ])
    return {"technical": technical, "finance": finance, "project": project, "hr": hr, "admin": admin, "sales": sales,
            "project_exec": project_exec, "accounts_exec": accounts_exec, "developer": developer, "sales_exec": sales_exec,
            "svp_projects": svp_projects, "avp_java": avp_java, "java_pm": java_pm, "java_tl": java_tl,
            "ba_testing": ba_testing, "sales_source": sales_source}


def add_users(db, s):
    def user(name, email, role, designation_key=None, manager=None):
        obj = db.scalar(select(User).where(User.email == email))
        if not obj:
            obj = User(name=name, email=email, password_hash=hash_password("Admin@123"), role=role,
                       designation_id=s[designation_key].id if designation_key else None,
                       manager_id=manager.id if manager else None)
            db.add(obj); db.flush()
        return obj
    admin = user("Super Admin", "admin@eaglesoftware.in", Role.superadmin)
    hrm = user("HR Manager", "hr@eaglesoftware.in", Role.hr, "hr_manager")
    project = user("Priya Project Manager", "project@eaglesoftware.in", Role.manager, "project_manager")
    finance = user("Kamakshi Finance Manager", "finance@eaglesoftware.in", Role.manager, "finance_manager")
    technical = user("Sankar AVP Technical", "sankar@eaglesoftware.in", Role.manager, "avp_technical")
    sales = user("Sales Manager", "sales@eaglesoftware.in", Role.manager, "sales_manager")
    admin_mgr = user("Admin Manager", "admin.manager@eaglesoftware.in", Role.manager, "admin_manager")
    svp_projects = user("SVP Projects", "svp.projects@eaglesoftware.in", Role.manager, "svp_projects")
    avp_java = user("AVP Technology", "avp.technology@eaglesoftware.in", Role.manager, "avp_technology", svp_projects)
    java_pm = user("Java Project Manager", "java.pm@eaglesoftware.in", Role.manager, "java_project_manager", avp_java)
    java_tl = user("Java Team Lead", "java.teamlead@eaglesoftware.in", Role.manager, "team_lead_java", java_pm)
    ba_testing = user("Business Analyst & Testing Lead", "ba.testing@eaglesoftware.in", Role.employee, "business_analyst_testing_lead", java_pm)
    user("Project Executive", "project.employee@eaglesoftware.in", Role.employee, "project_executive", project)
    user("Accounts Executive", "accounts@eaglesoftware.in", Role.employee, "accounts_executive", finance)
    user("Software Developer", "developer@eaglesoftware.in", Role.employee, "software_developer", technical)
    user("Sales Executive", "sales.employee@eaglesoftware.in", Role.employee, "sales_executive", sales)
    user("Mothini", "mothini@eaglesoftware.in", Role.employee, "software_developer", technical)
    db.commit()
    return {"admin": admin, "hr": hrm, "project": project, "finance": finance, "technical": technical, "sales": sales, "admin_mgr": admin_mgr,
            "svp_projects": svp_projects, "avp_java": avp_java, "java_pm": java_pm, "java_tl": java_tl, "ba_testing": ba_testing}


def fill_assignment(db, a, performance=0.82, finalize=True):
    template = db.scalar(select(KpiTemplate).where(KpiTemplate.id == a.template_id).options(joinedload(KpiTemplate.kras).joinedload(Kra.items)))
    for kra in template.kras:
        for i in kra.items:
            if i.input_type in {"percentage", "number", "currency", "days", "count"}:
                if i.direction == "lower" and i.target_value:
                    actual = i.target_value / max(performance, 0.2)
                elif i.target_value is not None:
                    actual = i.target_value * performance
                else:
                    actual = performance * 100
                r = KpiResponse(assignment_id=a.id, kpi_item_id=i.id, actual_numeric=round(actual, 2), remarks="Seeded demo response")
            elif i.input_type in {"choice", "yesno"}:
                option = "Good" if i.input_type == "choice" else "Yes"
                r = KpiResponse(assignment_id=a.id, kpi_item_id=i.id, selected_option=option, remarks="Seeded demo response")
            else:
                r = KpiResponse(assignment_id=a.id, kpi_item_id=i.id, actual_numeric=4)
            db.add(r)
    db.flush(); recalc_assignment(db, a.id)
    if finalize:
        a.status = AssignmentStatus.finalized
        a.manager_score = a.calculated_score
        a.final_score = a.calculated_score
    else:
        a.status = AssignmentStatus.draft
    db.flush()


def add_cycles_assignments(db, templates, users):
    cycle_defs = [
        ("January 2026", date(2026,1,1), date(2026,1,31), CycleStatus.closed),
        ("February 2026", date(2026,2,1), date(2026,2,28), CycleStatus.closed),
        ("March 2026", date(2026,3,1), date(2026,3,31), CycleStatus.closed),
        ("April 2026", date(2026,4,1), date(2026,4,30), CycleStatus.closed),
        ("May 2026", date(2026,5,1), date(2026,5,31), CycleStatus.closed),
        ("June 2026", date(2026,6,1), date(2026,6,30), CycleStatus.closed),
        ("July 2026", date(2026,7,1), date(2026,7,31), CycleStatus.closed),
        ("August 2026", date(2026,8,1), date(2026,8,31), CycleStatus.running),
        ("September 2026", date(2026,9,1), date(2026,9,30), CycleStatus.upcoming),
        ("October 2026", date(2026,10,1), date(2026,10,31), CycleStatus.upcoming),
        ("November 2026", date(2026,11,1), date(2026,11,30), CycleStatus.upcoming),
        ("December 2026", date(2026,12,1), date(2026,12,31), CycleStatus.upcoming),
    ]
    cycles = {}
    for name, start, end, status in cycle_defs:
        c = db.scalar(select(KpiCycle).where(KpiCycle.name == name))
        if not c:
            c = KpiCycle(name=name, month=start.replace(day=1), start_date=start, end_date=end, status=status)
            db.add(c); db.flush()
        cycles[name] = c

    people = [
        (users["technical"], templates["technical"]),
        (users["finance"], templates["finance"]),
        (users["project"], templates["project"]),
        (users["hr"], templates["hr"]),
        (users["admin_mgr"], templates["admin"]),
        (users["sales"], templates["sales_source"]),
        (users["svp_projects"], templates["svp_projects"]),
        (users["avp_java"], templates["avp_java"]),
        (users["java_pm"], templates["java_pm"]),
        (users["java_tl"], templates["java_tl"]),
        (users["ba_testing"], templates["ba_testing"]),
    ]
    history = [0.72, 0.76, 0.79, 0.82, 0.85]
    for person_idx, (u, t) in enumerate(people):
        for month_idx, month_name in enumerate(["March 2026", "April 2026", "May 2026", "June 2026", "July 2026"]):
            c = cycles[month_name]
            a = db.scalar(select(KpiAssignment).where(KpiAssignment.cycle_id == c.id, KpiAssignment.user_id == u.id))
            if not a:
                a = KpiAssignment(cycle_id=c.id, user_id=u.id, template_id=t.id)
                db.add(a); db.flush()
                perf = min(0.96, history[month_idx] + person_idx * 0.02)
                fill_assignment(db, a, perf, True)

    # Current month records deliberately include different workflow states for demo/review screens.
    aug = cycles["August 2026"]
    current_states = [
        (users["technical"], templates["technical"], 0.91, "finalized"),
        (users["finance"], templates["finance"], 0.87, "manager_reviewed"),
        (users["project"], templates["project"], 0.84, "submitted"),
        (users["hr"], templates["hr"], 0.89, "draft"),
        (users["admin_mgr"], templates["admin"], 0.81, "draft"),
        (users["sales"], templates["sales_source"], 0.78, "draft"),
        (users["svp_projects"], templates["svp_projects"], 0.90, "manager_reviewed"),
        (users["avp_java"], templates["avp_java"], 0.88, "submitted"),
        (users["java_pm"], templates["java_pm"], 0.86, "submitted"),
        (users["java_tl"], templates["java_tl"], 0.84, "draft"),
        (users["ba_testing"], templates["ba_testing"], 0.87, "draft"),
    ]
    for u, t, perf, state in current_states:
        a = db.scalar(select(KpiAssignment).where(KpiAssignment.cycle_id == aug.id, KpiAssignment.user_id == u.id))
        if not a:
            a = KpiAssignment(cycle_id=aug.id, user_id=u.id, template_id=t.id)
            db.add(a); db.flush(); fill_assignment(db, a, perf, state == "finalized")
            if state == "manager_reviewed":
                a.status = AssignmentStatus.manager_reviewed; a.manager_score = a.calculated_score; a.final_score = None
            elif state == "submitted":
                a.status = AssignmentStatus.submitted; a.final_score = None
            elif state == "draft":
                a.status = AssignmentStatus.draft; a.manager_score = None; a.final_score = None

    # Direct-report employee demo assignments make Employee and Manager logins useful immediately.
    employee_pairs = [
        ("project.employee@kpi.local", templates["project_exec"]),
        ("accounts@kpi.local", templates["accounts_exec"]),
        ("developer@kpi.local", templates["developer"]),
        ("sales.employee@kpi.local", templates["sales_exec"]),
    ]
    for idx, (email, template) in enumerate(employee_pairs):
        u = db.scalar(select(User).where(User.email == email))
        if not u:
            continue
        for month_idx, month_name in enumerate(["May 2026", "June 2026", "July 2026"]):
            c = cycles[month_name]
            a = db.scalar(select(KpiAssignment).where(KpiAssignment.cycle_id == c.id, KpiAssignment.user_id == u.id))
            if not a:
                a = KpiAssignment(cycle_id=c.id, user_id=u.id, template_id=template.id)
                db.add(a); db.flush(); fill_assignment(db, a, min(0.94, 0.74 + month_idx*0.05 + idx*0.02), True)
        a = db.scalar(select(KpiAssignment).where(KpiAssignment.cycle_id == aug.id, KpiAssignment.user_id == u.id))
        if not a:
            a = KpiAssignment(cycle_id=aug.id, user_id=u.id, template_id=template.id)
            db.add(a); db.flush(); fill_assignment(db, a, 0.82 + idx*0.03, False)
            if idx == 0:
                a.status = AssignmentStatus.submitted

    db.commit()


def main():
    db = SessionLocal()
    try:
        s = add_structure(db)
        templates = add_templates(db, s)
        users = add_users(db, s)
        marker = db.get(SystemSetting, "demo_seed_completed")
        if not marker:
            add_cycles_assignments(db, templates, users)
            db.add(SystemSetting(key="demo_seed_completed", value={"completed": True}))
            db.commit()
            print("Initial demo seed complete. Login: admin@kpi.local / Admin@123")
        else:
            print("Master/demo seed already initialized; transactional KPI data left unchanged.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
