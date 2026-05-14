import type { SVGProps } from "react"

export default function HelicopterIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M19 12H5" />
            <path d="M19 6H5" />
            <path d="M12 6v6" />
            <path d="M3 13a3 3 0 1 0 6 0" />
            <path d="M9 13h10a3 3 0 0 1 3 3v2" />
            <path d="M4 16v2" />
            <path d="M14 6c0-2-2-2-2-4-2 0-2 2-2 4" />
        </svg>
    )
}
