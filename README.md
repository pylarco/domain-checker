# Bulk Domain Availability Checker

A powerful and fast web application for checking the availability of a large number of domain names across multiple Top-Level Domains (TLDs) in bulk.

## Features

- **Bulk Checking:** Check thousands of domain combinations at once.
- **Multiple TLDs:** Check against a custom list of TLDs.
- **Fast & Reliable:** Uses DNS-over-HTTPS (DoH) with multiple providers (Cloudflare, Google) for accurate and fast results.
- **Advanced Filtering & Sorting:** Easily filter and sort the results to find available domains.
- **Responsive UI:** A clean and modern user interface that works on all screen sizes.
- **Copy Results:** Quickly copy filtered base names to your clipboard.

## How it Works

The application takes a list of base names (e.g., `example`, `mydomain`) and a list of TLDs (e.g., `com`, `net`, `org`) and generates all possible domain combinations.

For each domain, it performs DNS lookups for `A` and `NS` records using DNS-over-HTTPS (DoH). This method is generally more reliable and faster than traditional WHOIS lookups.

- A domain is considered **taken** if any DoH query returns a `NOERROR` status, indicating that DNS records exist.
- A domain is considered **available** if all DoH queries return `NXDOMAIN`, meaning the domain does not exist.
- If the results are ambiguous, the application conservatively marks the domain as **taken**.

## Technology Stack

- **Frontend:** [React](https://reactjs.org/) with [TypeScript](https://www.typescriptlang.org/)
- **Build Tool:** [Vite](https://vitejs.dev/)
- **Package Manager:** [Bun](https://bun.sh/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)

## Getting Started

Follow these steps to run the application locally.

### Prerequisites

- [Bun](https://bun.sh/docs/installation) installed on your machine.

### Installation & Running

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```

2.  **Install dependencies:**
    ```bash
    bun install
    ```

3.  **Run the development server:**
    ```bash
    bun run dev
    ```

The application will be available at `http://localhost:5173`.