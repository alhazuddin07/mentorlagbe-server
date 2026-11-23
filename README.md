# MentorLagbe – Server Side

The backend API for **MentorLagbe**, a Smart Tuition & Mentorship Platform built with Node.js, Express.js, and MongoDB.

This server handles tuition management, student applications, user authorization, admin operations, and Stripe subscription payments. It provides secure REST APIs for the MentorLagbe frontend.

## 🚀 Key Features

### 🔐 Authentication & Authorization
- JWT token verification for protected API routes.
- Role-based access control.
- Custom middleware for:
  - `verifyToken`
  - `verifyStudent`
  - `verifyTutor`
  - `verifyAdmin`
- Secure access to protected resources.
- User role and subscription plan management.

### 📚 Tuition Management
- Create new tuition listings.
- Retrieve approved and active tuitions.
- Get individual tuition details.
- Update and delete tuition posts.
- Admin approval and rejection system.
- Toggle tuition availability (Active / Closed).
- Free and Pro plan-based tuition posting limits.

### 🔎 Search & Filtering
- Server-side search by tuition title and subject.
- Filter by subject.
- Filter by class level.
- Filter by learning mode (Online / Offline).
- MongoDB-based query filtering.

### 📝 Application Management
- Submit tuition applications.
- Prevent duplicate applications.
- Retrieve student applications.
- Retrieve tutor applicants.
- Update application status.
- Accept or reject student applications.
- Cancel pending applications.

### 👨‍💼 Admin Management
- Retrieve platform statistics.
- Manage registered users.
- Update user roles.
- Approve or reject tuition listings.
- Retrieve payment transactions.
- Monitor platform revenue.

### 💳 Stripe Payment Integration
- Create Stripe Checkout Sessions.
- Separate Pro subscription plans for Students and Tutors.
- Verify successful payments.
- Handle Stripe Webhook events.
- Update user subscription plans after successful payment.
- Store payment transaction records.

### 🖼️ Image Upload
- Supports image upload workflow using ImgBB API.
- Receives and stores image URLs for user profiles and tuition banners.

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express.js | Backend framework |
| MongoDB | Database |
| MongoDB Native Driver | Database operations |
| JWT | Authentication |
| Stripe | Subscription payments |
| CORS | Cross-origin resource sharing |
| dotenv | Environment variable management |

## ⚙️ Installation & Setup

### Prerequisites

- Node.js
- npm
- MongoDB Atlas account
- Stripe account

### 1. Clone the Repository

```bash
git clone YOUR_SERVER_REPOSITORY_URL
```

### 2. Navigate to the Project Directory

```bash
cd mentorlagbe-server
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the root directory and configure the required server environment variables.

```env
PORT=5000

JWT_SECRET=your_jwt_secret

STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

CLIENT_URL=http://localhost:3000
```

Add any other environment variables required by your implementation.

**Important:** Never expose sensitive credentials or secret keys in your GitHub repository.

### 5. Run the Development Server

```bash
npm run dev
```

Or, if your project uses a start script:

```bash
npm start
```

The server will run at:

```text
http://localhost:5000
```

## 🔒 Security

- Protected API routes using JWT verification.
- Role-based authorization through custom middleware.
- Environment variables for sensitive credentials.
- Server-side validation for important operations.
- Restricted access to administrative operations.
- Stripe payment verification before updating subscription status.

## 📁 Project Structure

```text
mentorlagbe-server/
│
├── index.js
├── .env
├── package.json
├── package-lock.json
│
└── [Other project modules]
```

*The structure above is illustrative. Update it according to your actual server-side folder structure.*

## 🌐 Deployment

The backend is deployed on Vercel.

- **Live API:** https://mentorlagbe-server-zeta.vercel.app/
- **Client Application:** https://mentorlagbe-client-xi.vercel.app/

Make sure all required environment variables are configured in the deployment platform before deploying.

## 👨‍💻 Author

**Alhaz Uddin**

- GitHub: https://github.com/alhazuddin07
- Project: MentorLagbe

---

⭐ If you find this project useful, consider giving the repository a star!
