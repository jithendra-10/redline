import type { EntityType } from '../types';

/**
 * Labelled evaluation set: 30 realistic pastes (10 legal, 10 medical, 10 HR/finance).
 * `must` lists every span that must not survive redaction. All names, companies,
 * numbers and addresses are fictional.
 */
export interface Sample {
  id: string;
  domain: 'legal' | 'medical' | 'hr';
  text: string;
  must: Array<{ text: string; type: EntityType }>;
}

const S = (id: string, domain: Sample['domain'], text: string, must: Array<[string, EntityType]>): Sample => ({
  id, domain, text, must: must.map(([t, type]) => ({ text: t, type })),
});

export const SAMPLES: Sample[] = [
  // ---------------- Legal ----------------
  S('legal-01', 'legal',
    'Please tighten this: "Our client Priya Shah (matter #LGL-2291) will not accept the Acme Corp settlement of $4.2M. Ms. Shah asks that calls go to +1 512-555-0148 or priya.shah@shahlegal.com."',
    [['Priya Shah', 'PERSON'], ['Shah', 'PERSON'], ['LGL-2291', 'CLIENT_ID'], ['Acme Corp', 'ORG'], ['$4.2M', 'FINANCIAL'], ['+1 512-555-0148', 'PHONE'], ['priya.shah@shahlegal.com', 'EMAIL']]),
  S('legal-02', 'legal',
    'Summarize the deposition of Mark Whitfield taken on behalf of Halvorsen Shipping Ltd in case no. CV-2024-00813. Mr. Whitfield admitted the cargo was stored at 44 Wharf Road, Tacoma.',
    [['Mark Whitfield', 'PERSON'], ['Whitfield', 'PERSON'], ['Halvorsen Shipping Ltd', 'ORG'], ['CV-2024-00813', 'CLIENT_ID'], ['44 Wharf Road, Tacoma', 'ADDRESS']]),
  S('legal-03', 'legal',
    'Draft a cease-and-desist from Brightline Legal LLP to Copperfield Media Inc. regarding their use of our client Elena Marquez\'s photographs. Damages claimed: $85,000.',
    [['Brightline Legal LLP', 'ORG'], ['Copperfield Media Inc.', 'ORG'], ['Elena Marquez', 'PERSON'], ['$85,000', 'FINANCIAL']]),
  S('legal-04', 'legal',
    'Rewrite for a judge: Defendant Tomasz Nowak, SSN 512-44-9087, was employed by Vantage Logistics until March. His attorney is Rachel Kim (rkim@kimlaw.com).',
    [['Tomasz Nowak', 'PERSON'], ['512-44-9087', 'GOV_ID'], ['Vantage Logistics', 'ORG'], ['Rachel Kim', 'PERSON'], ['rkim@kimlaw.com', 'EMAIL']]),
  S('legal-05', 'legal',
    'Is this NDA clause enforceable? "Project Bluebird details shared between Orion Robotics and Daniel Osei may not be disclosed for 5 years."',
    [['Project Bluebird', 'PROJECT_CODENAME'], ['Orion Robotics', 'ORG'], ['Daniel Osei', 'PERSON']]),
  S('legal-06', 'legal',
    'Translate to plain English: the lessee, Fatima Al-Sayed, residing at 17 Cedar Lane, Leeds LS6 2AB, owes £12,400 in arrears to Greystone Property Management.',
    [['Fatima Al-Sayed', 'PERSON'], ['17 Cedar Lane, Leeds LS6 2AB', 'ADDRESS'], ['£12,400', 'FINANCIAL'], ['Greystone Property Management', 'ORG']]),
  S('legal-07', 'legal',
    'Make this email firmer: Hi Joanna, as discussed, Mr. Reyes will not sign the Lumen Bank loan guarantee (account 4417-2290-1183) unless the rate drops.',
    [['Joanna', 'PERSON'], ['Reyes', 'PERSON'], ['Lumen Bank', 'ORG'], ['4417-2290-1183', 'CLIENT_ID']]),
  S('legal-08', 'legal',
    'Check the tone: Our firm represents Arjun Mehta in his divorce from Kavya Mehta. Assets include a flat in Bandra, Mumbai and ₹2.5 crore in savings.',
    [['Arjun Mehta', 'PERSON'], ['Kavya Mehta', 'PERSON'], ['Bandra, Mumbai', 'ADDRESS'], ['₹2.5 crore', 'FINANCIAL']]),
  S('legal-09', 'legal',
    'Summarize: In Hartley v. Northgate Pharmaceuticals, plaintiff Susan Hartley alleges her late husband was harmed by the drug Zelvoran.',
    [['Susan Hartley', 'PERSON'], ['Hartley', 'PERSON'], ['Northgate Pharmaceuticals', 'ORG'], ['Zelvoran', 'MEDICATION']]),
  S('legal-10', 'legal',
    'Proofread: The arbitration between Kestrel Energy and Dunmore Holdings (ref ARB/22/417) will be heard by Hon. Margaret Okonkwo on 12 May.',
    [['Kestrel Energy', 'ORG'], ['Dunmore Holdings', 'ORG'], ['ARB/22/417', 'CLIENT_ID'], ['Margaret Okonkwo', 'PERSON']]),

  // ---------------- Medical ----------------
  S('med-01', 'medical',
    'Summarize this referral: Patient John Miller, DOB 03/14/1961, MRN 448812, presented at St. Mary\'s Hospital with suspected chronic lymphocytic leukemia. Currently on ibrutinib 420mg daily. Referred by Dr. Anita Rao.',
    [['John Miller', 'PERSON'], ['DOB 03/14/1961', 'DATE_OF_BIRTH'], ['448812', 'CLIENT_ID'], ["St. Mary's Hospital", 'ORG'], ['chronic lymphocytic leukemia', 'MEDICAL_CONDITION'], ['ibrutinib 420mg', 'MEDICATION'], ['Anita Rao', 'PERSON']]),
  S('med-02', 'medical',
    'Explain in simple words for the family: Mrs. Grace Holloway (bed 12, ward C) has stage 3 chronic kidney disease and was started on furosemide 40mg.',
    [['Grace Holloway', 'PERSON'], ['chronic kidney disease', 'MEDICAL_CONDITION'], ['furosemide 40mg', 'MEDICATION']]),
  S('med-03', 'medical',
    'Write a discharge letter: Rahul Verma, patient ID PT-77120, treated at Apollo Clinic Chennai for type 2 diabetes. Prescribed metformin 500mg twice daily. Contact: +91 98450 12345.',
    [['Rahul Verma', 'PERSON'], ['PT-77120', 'CLIENT_ID'], ['Apollo Clinic Chennai', 'ORG'], ['type 2 diabetes', 'MEDICAL_CONDITION'], ['metformin 500mg', 'MEDICATION'], ['+91 98450 12345', 'PHONE']]),
  S('med-04', 'medical',
    'Make this note clearer: Seen Liam O\'Connor, 34, for panic disorder and major depressive disorder. Continue sertraline 100mg. Next review with Dr. Helen Park.',
    [["Liam O'Connor", 'PERSON'], ['panic disorder', 'MEDICAL_CONDITION'], ['major depressive disorder', 'MEDICAL_CONDITION'], ['sertraline 100mg', 'MEDICATION'], ['Helen Park', 'PERSON']]),
  S('med-05', 'medical',
    'Shorten: Lab results for Maria Gonzalez (NHS 943 476 5919) show HIV viral load undetectable on Biktarvy. Clinic: Riverside Sexual Health Centre.',
    [['Maria Gonzalez', 'PERSON'], ['943 476 5919', 'GOV_ID'], ['HIV', 'MEDICAL_CONDITION'], ['Biktarvy', 'MEDICATION'], ['Riverside Sexual Health Centre', 'ORG']]),
  S('med-06', 'medical',
    'Draft an insurance appeal for Kenji Watanabe, policy BX-4471902, denied coverage for multiple sclerosis treatment with ocrelizumab at Bayview Medical Center.',
    [['Kenji Watanabe', 'PERSON'], ['BX-4471902', 'CLIENT_ID'], ['multiple sclerosis', 'MEDICAL_CONDITION'], ['ocrelizumab', 'MEDICATION'], ['Bayview Medical Center', 'ORG']]),
  S('med-07', 'medical',
    'Simplify for a parent: Your son Ethan Brooks (born 2015-07-22) has been diagnosed with ADHD and will start methylphenidate 10mg. Questions: nurse@lakesidepeds.org.',
    [['Ethan Brooks', 'PERSON'], ['born 2015-07-22', 'DATE_OF_BIRTH'], ['ADHD', 'MEDICAL_CONDITION'], ['methylphenidate 10mg', 'MEDICATION'], ['nurse@lakesidepeds.org', 'EMAIL']]),
  S('med-08', 'medical',
    'Summarize the case for the tumour board: Ana Lucia Ferreira, 52, HER2-positive breast cancer, completed trastuzumab. Lives at 9 Rua das Flores, Porto.',
    [['Ana Lucia Ferreira', 'PERSON'], ['HER2-positive breast cancer', 'MEDICAL_CONDITION'], ['trastuzumab', 'MEDICATION'], ['9 Rua das Flores, Porto', 'ADDRESS']]),
  S('med-09', 'medical',
    'Rewrite politely: Dr. Samuel Adeyemi, please see Mr. Peter Lindqvist again re: his alcohol use disorder; he missed the naltrexone refill at Northside Pharmacy.',
    [['Samuel Adeyemi', 'PERSON'], ['Peter Lindqvist', 'PERSON'], ['alcohol use disorder', 'MEDICAL_CONDITION'], ['naltrexone', 'MEDICATION'], ['Northside Pharmacy', 'ORG']]),
  S('med-10', 'medical',
    'Explain this result to Sophie Turner: her BRCA1 mutation test from Genova Labs was positive. Her sister Claire Turner should also be tested.',
    [['Sophie Turner', 'PERSON'], ['BRCA1 mutation', 'MEDICAL_CONDITION'], ['Genova Labs', 'ORG'], ['Claire Turner', 'PERSON']]),

  // ---------------- HR / finance ----------------
  S('hr-01', 'hr',
    'Rewrite this kindly: We are terminating Daniel Okafor (employee ID E-10432) from Project Falcon effective Friday. His salary of $148,000 will be paid through December. Contact his manager Laura Chen at laura.chen@northwind.io.',
    [['Daniel Okafor', 'PERSON'], ['E-10432', 'CLIENT_ID'], ['Project Falcon', 'PROJECT_CODENAME'], ['$148,000', 'FINANCIAL'], ['Laura Chen', 'PERSON'], ['laura.chen@northwind.io', 'EMAIL']]),
  S('hr-02', 'hr',
    'Make this performance review constructive: Wei Zhang has missed three deadlines on the Atlas migration. Recommend a PIP. Current band: L5, base €96,000.',
    [['Wei Zhang', 'PERSON'], ['Atlas migration', 'PROJECT_CODENAME'], ['€96,000', 'FINANCIAL']]),
  S('hr-03', 'hr',
    'Draft an offer letter: Candidate Aisha Bello, offered Senior Analyst at Meridian Capital, salary ₹32 lakh, joining bonus ₹3 lakh. Personal email aisha.bello88@gmail.com.',
    [['Aisha Bello', 'PERSON'], ['Meridian Capital', 'ORG'], ['₹32 lakh', 'FINANCIAL'], ['₹3 lakh', 'FINANCIAL'], ['aisha.bello88@gmail.com', 'EMAIL']]),
  S('hr-04', 'hr',
    'Summarize the complaint: Jordan Ellis reported harassment by his supervisor Kevin Murphy at the Denver warehouse of Summit Freight. Case HR-2025-118.',
    [['Jordan Ellis', 'PERSON'], ['Kevin Murphy', 'PERSON'], ['Summit Freight', 'ORG'], ['HR-2025-118', 'CLIENT_ID']]),
  S('hr-05', 'hr',
    'Turn into bullet points: Q3 bonus pool $2.1M. Top earners: Nina Petrova $310K, Omar Haddad $275K. Payroll account GB33BUKB20201555555555.',
    [['$2.1M', 'FINANCIAL'], ['Nina Petrova', 'PERSON'], ['$310K', 'FINANCIAL'], ['Omar Haddad', 'PERSON'], ['$275K', 'FINANCIAL'], ['GB33BUKB20201555555555', 'BANK_ACCOUNT']]),
  S('hr-06', 'hr',
    'Write a reference for Carlos Mendes, who worked at Tidewater Systems from 2019 to 2024 and led the Project Nightjar launch. Reach me at 020 7946 0958.',
    [['Carlos Mendes', 'PERSON'], ['Tidewater Systems', 'ORG'], ['Project Nightjar', 'PROJECT_CODENAME'], ['020 7946 0958', 'PHONE']]),
  S('hr-07', 'hr',
    'Polish this: Expense claim from Hannah Schmidt rejected. Card 5500 0000 0000 0004 was charged $4,380 at the Hotel Adlon during the Siemens offsite.',
    [['Hannah Schmidt', 'PERSON'], ['5500 0000 0000 0004', 'CARD_NUMBER'], ['$4,380', 'FINANCIAL'], ['Hotel Adlon', 'ORG'], ['Siemens', 'ORG']]),
  S('hr-08', 'hr',
    'Make this layoff memo humane: Roles affected in the Pune office include Sneha Kulkarni and Vikram Rao. Severance is 3 months pay. Questions to hr@zenithsoft.in.',
    [['Sneha Kulkarni', 'PERSON'], ['Vikram Rao', 'PERSON'], ['hr@zenithsoft.in', 'EMAIL']]),
  S('hr-09', 'hr',
    'Summarize this board note: Acquisition of Quillstone Analytics by Harbor Peak Partners for $640M is confidential until announcement. Codename: Project Lantern.',
    [['Quillstone Analytics', 'ORG'], ['Harbor Peak Partners', 'ORG'], ['$640M', 'FINANCIAL'], ['Project Lantern', 'PROJECT_CODENAME']]),
  S('hr-10', 'hr',
    'Make this accommodation request formal: Employee Ruth Abernathy (ID 55102) needs reduced hours due to her Crohn\'s disease flare. Her manager Tom Becker approved.',
    [['Ruth Abernathy', 'PERSON'], ['55102', 'CLIENT_ID'], ["Crohn's disease", 'MEDICAL_CONDITION'], ['Tom Becker', 'PERSON']]),
];
