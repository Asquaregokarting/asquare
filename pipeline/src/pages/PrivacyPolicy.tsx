import { motion } from 'framer-motion'
import { ChevronLeft, Shield, Lock, Eye, FileText, Mail, MessageSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import SEO from '../components/SEO'

export default function PrivacyPolicy() {
    const navigate = useNavigate()

    const sections = [
        {
            title: '1. Introduction',
            icon: <Shield className="w-5 h-5 text-primary-400" />,
            content: `A Square Gokarting respects your privacy and recognizes the need to protect your personal information (any information by which you can be identified, such as name, address, financial information, and telephone number) you share with us. We would like to assure you that we follow appropriate standards when it comes to protecting your privacy on our web sites and applications.
      
      In general, you can visit app.asquaregokarting.com without telling us who you are or revealing any personal information about yourself. We track the Internet address of the domains from which people visit us and analyze this data for trends and statistics, but the individual user remains anonymous.`
        },
        {
            title: '2. Age Requirement',
            icon: <Lock className="w-5 h-5 text-secondary-400" />,
            content: `Please note that our Privacy Policy forms part of our Terms and conditions. A transaction on A Square Gokarting is to be conducted by persons above the age of 18 years only. If you are under 18 years of age, you are not allowed to make a transaction in A Square Gokarting. 
      
      It is the duty of the legal guardians of all persons below 18 years of age to ensure that their wards do not make a transaction without their supervision. It shall be automatically deemed that by allowing any person below the age of 18 years to transact, their legal guardians have expressly consented to their use.`
        },
        {
            title: '3. Data Collection',
            icon: <Eye className="w-5 h-5 text-primary-400" />,
            content: `We may collect your personal data when you:
      • Create an account with us
      • Use any related services connected to A Square Gokarting
      • Participate in contests, surveys, or promoted activities
      • Complete contact forms or request newsletters
      
      We also automatically collect technical data including Browser type, IP address, Language, Operating system, Cookies, device IDs, and usage behavior (content viewed, searched, or transacted).`
        },
        {
            title: '4. How We Use Your Data',
            icon: <FileText className="w-5 h-5 text-secondary-400" />,
            content: `The personal data we collect will be used for:
      • Creating and maintaining your account/profile
      • Tracking activity and carrying out financial transactions
      • Research and analytics on user demographics and behavior
      • Personalizing communications and enhancing user experience
      • Verifying eligibility for marketing events
      • Fraud screening and prevention`
        },
        {
            title: '5. Data Security',
            icon: <Lock className="w-5 h-5 text-green-400" />,
            content: `We have implemented reasonable security arrangements including physical, administrative, technical, and electronic security measures.
      
      We are PCI DSS certified, which means the data you submit to us is secure and protected against loss or theft in accordance with globally accepted data security standards. However, no security measures are perfect or impenetrable.`
        },
        {
            title: '6. Grievance Redressal',
            icon: <MessageSquare className="w-5 h-5 text-primary-400" />,
            content: `At A Square Gokarting, your experience is of utmost importance. If you have an enquiry or complaint, you may contact our Customer Experience Grievance Officer:
      
      • Level 1: Support via Live Chat (3-day resolution)
      • Level 2: Write to escalations@asquaregokarting.com (2-day resolution)
      • Level 3: Contact General Manager (G V Sravan Kumar) at asquaregokarting@gmail.com (1-day resolution)`
        }
    ]

    return (
        <div className="min-h-screen bg-dark-900 pb-20">
            <SEO
                title="Privacy Policy"
                description="A Square GoKarting privacy policy. Learn how we collect, use, and protect your personal information when using our app and services."
                path="/privacy"
            />
            {/* Sticky Header */}
            <div className="sticky top-0 z-50 bg-dark-900/80 backdrop-blur-xl border-b border-white/5 p-4 flex items-center gap-4">
                <button
                    onClick={() => navigate(-1)}
                    className="p-2 hover:bg-dark-800 rounded-full transition-colors"
                >
                    <ChevronLeft className="w-6 h-6 text-white" />
                </button>
                <div>
                    <h1 className="text-white font-display font-bold text-lg">Privacy Policy</h1>
                    <p className="text-dark-500 text-xs">Last updated Oct 20, 2020</p>
                </div>
            </div>

            <div className="max-w-3xl mx-auto px-4 py-8">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-8"
                >
                    {/* Hero Section */}
                    <div className="bg-gradient-to-br from-primary-500/10 to-secondary-500/10 border border-white/10 rounded-3xl p-6 mb-8">
                        <h2 className="text-white font-display font-bold text-xl mb-3">Our Commitment</h2>
                        <p className="text-dark-300 text-sm leading-relaxed">
                            We follow appropriate standards when it comes to protecting your privacy on our web sites and applications. Your trust is our most valuable asset.
                        </p>
                    </div>

                    {/* Dynamic Sections */}
                    {sections.map((section, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            className="group"
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <div className="p-2 bg-dark-800 rounded-xl group-hover:bg-dark-700 transition-colors">
                                    {section.icon}
                                </div>
                                <h3 className="text-white font-bold text-lg">{section.title}</h3>
                            </div>
                            <div className="pl-13">
                                <p className="text-dark-400 text-sm leading-relaxed whitespace-pre-wrap">
                                    {section.content}
                                </p>
                            </div>
                            {idx !== sections.length - 1 && (
                                <div className="h-px bg-white/5 mt-8 ml-13" />
                            )}
                        </motion.div>
                    ))}

                    {/* Contact Footer */}
                    <div className="mt-12 p-6 bg-dark-800 rounded-3xl border border-white/5 text-center">
                        <Mail className="w-8 h-8 text-primary-400 mx-auto mb-4" />
                        <h3 className="text-white font-bold mb-2">Have Questions?</h3>
                        <p className="text-dark-400 text-xs mb-4">
                            If you have concerns or inquiries, reference the privacy policy in your subject line.
                        </p>
                        <a
                            href="mailto:asquaregokarting@gmail.com"
                            className="inline-block px-6 py-2.5 bg-primary-500 text-white font-bold rounded-xl text-sm"
                        >
                            Contact Us
                        </a>
                    </div>

                    <p className="text-center text-dark-600 text-[10px] mt-8 pb-10">
                        © 2026 A Square Go-Karting & Entertainment. All Rights Reserved.
                    </p>
                </motion.div>
            </div>
        </div>
    )
}
